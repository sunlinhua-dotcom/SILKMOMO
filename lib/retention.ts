/**
 * 数据保留清理（retention）。
 *
 * 为什么存在：GenerationRecord（含 promptText）和已结束的脸库任务只增不减，库会无限长大。
 * 这里按策略分批清理，由 instrumentation.ts 启动：启动 10 分钟后跑第一次，之后每 24 小时一次。
 *
 * 策略（详见 docs/handoff/retention-1008.md）：
 *   - GenerationRecord：createdAt 早于 GENERATION_RECORD_RETENTION_DAYS（默认 365）天，
 *     且 rating = 0、feedback 为空、feedbackTags 为空的才删——有用户评价/反馈的永久保留。
 *     依赖说明：lib/billing-reconcile.ts 的 hasSuccessRecord 只查「扣费后 20 分钟窗口内」的成功记录，
 *     365 天的保留期远大于该窗口，所以清理不会影响孤儿对账；若把保留天数调到接近 0，必须先回看那里。
 *   - ModelFaceGenerationJob：status 为 completed/failed、finishedAt 早于
 *     MODEL_FACE_JOB_RETENTION_DAYS（默认 30）天，且所有 item 的 billingStatus 都处于终态
 *     （uncharged / refunded / kept）才删，item 随 job 级联删除。charged 与 refund_pending 都不是终态——
 *     前者可能被退款扫描再次接管，后者是明确的待退款——只要 job 下有一条这样的 item，整个 job 都保留。
 *     ModelFace 本身不动：item.faceId 的外键是 ON DELETE SET NULL，方向是「item 指向 face」，删 item 不会碰 face。
 *   - Transaction（账务）、ModelFace（用户资产）永不删除；PendingImage 已有 TTL（lib/pending-image.ts），不在此处理。
 *
 * 运行方式：
 *   - 多实例用 PostgreSQL advisory lock 互斥。用的是事务级的 pg_try_advisory_xact_lock，而不是会话级的
 *     pg_try_advisory_lock：Prisma 走连接池，会话级锁和解锁不保证落在同一条连接上，会泄漏成永久锁；
 *     事务级锁随「租约事务」结束（含进程被杀、连接断开）自动释放。租约事务里只持有锁、不做删除，
 *     删除走普通连接，所以不会长时间持有行锁。
 *   - 分批删除（每批 ≤ 500 行），批间让出事件循环；每批前对租约事务做一次心跳，租约丢了就中止本轮。
 *   - RETENTION_DRY_RUN=1 只统计不删除；RETENTION_DISABLED=1 完全关闭。
 *   - 其它模块可通过 registerRetentionTask(name, fn) 接入额外的清理函数，与内置任务同批执行、互相隔离。
 *
 * 本文件的纯逻辑（runRetention 及配置/where 构造）不 import 任何运行时依赖，方便 node:test 直接加载；
 * 真实的数据库依赖只在 createDefaultRetentionDeps 里按需动态加载。
 */

export const RETENTION_FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RETENTION_BATCH_SIZE = 500;
/** 批间停顿：给事件循环和数据库留喘息，避免清理期间拖慢线上请求。 */
export const RETENTION_BATCH_PAUSE_MS = 50;
/** 单轮最长运行时间；到点就停，剩下的留给下一轮。必须小于 RETENTION_LOCK_LEASE_MS。 */
export const RETENTION_MAX_RUN_MS = 50 * 60 * 1000;
/** 租约事务的超时。 */
export const RETENTION_LOCK_LEASE_MS = 60 * 60 * 1000;
/** 单任务单轮最多处理的批数，防御「删不动却一直有数据」导致的死循环。 */
export const RETENTION_MAX_BATCHES_PER_TASK = 4000;
/** advisory lock 的固定键（任意常量即可，所有实例一致）。 */
export const RETENTION_ADVISORY_LOCK_KEY = 7300100801;

export const DEFAULT_GENERATION_RECORD_RETENTION_DAYS = 365;
export const DEFAULT_MODEL_FACE_JOB_RETENTION_DAYS = 30;

/** 脸库 item 计费终态：不会再有钱的动作。charged / refund_pending 不是终态。 */
export const MODEL_FACE_TERMINAL_BILLING_STATUSES = ['uncharged', 'refunded', 'kept'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────── 配置 ───────────────────────────

export interface RetentionConfig {
  disabled: boolean;
  dryRun: boolean;
  generationRecordDays: number;
  modelFaceJobDays: number;
  batchSize: number;
}

function flag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function positiveInt(value: string | undefined, fallback: number, name: string, warn?: (msg: string) => void): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    warn?.(`${name}=${JSON.stringify(value)} 非法（需 ≥1 的整数），改用默认值 ${fallback}`);
    return fallback;
  }
  return parsed;
}

export function readRetentionConfig(
  env: Record<string, string | undefined> = process.env,
  warn?: (msg: string) => void,
): RetentionConfig {
  return {
    disabled: flag(env.RETENTION_DISABLED),
    dryRun: flag(env.RETENTION_DRY_RUN),
    generationRecordDays: positiveInt(
      env.GENERATION_RECORD_RETENTION_DAYS, DEFAULT_GENERATION_RECORD_RETENTION_DAYS, 'GENERATION_RECORD_RETENTION_DAYS', warn,
    ),
    modelFaceJobDays: positiveInt(
      env.MODEL_FACE_JOB_RETENTION_DAYS, DEFAULT_MODEL_FACE_JOB_RETENTION_DAYS, 'MODEL_FACE_JOB_RETENTION_DAYS', warn,
    ),
    batchSize: RETENTION_BATCH_SIZE,
  };
}

// ─────────────────────────── where 条件（单一来源，测试直接断言） ───────────────────────────

/** 可清理的 GenerationRecord：超期、未评分、无文字反馈、无反馈标签。 */
export function generationRecordRetentionWhere(cutoff: Date) {
  return {
    createdAt: { lt: cutoff },
    rating: 0,
    feedback: '',
    feedbackTags: '[]',
  };
}

/** 可清理的脸库任务：已结束、超期、且没有任何非终态计费的 item。 */
export function modelFaceJobRetentionWhere(cutoff: Date) {
  return {
    status: { in: ['completed', 'failed'] },
    finishedAt: { lt: cutoff },
    items: { none: { billingStatus: { notIn: [...MODEL_FACE_TERMINAL_BILLING_STATUSES] } } },
  };
}

// ─────────────────────────── 存储抽象 ───────────────────────────

export interface RetentionPurgeOps {
  /** dry-run 用：统计会被删多少行。 */
  count(): Promise<number>;
  /** 取下一批可删 id（最多 limit 个）。 */
  listIds(limit: number): Promise<string[]>;
  /** 删除这批 id，返回实际删除行数。实现里必须把保留条件再带一遍（防止列出与删除之间状态变化）。 */
  deleteIds(ids: string[]): Promise<number>;
}

export interface RetentionStore {
  generationRecords(cutoff: Date): RetentionPurgeOps;
  modelFaceJobs(cutoff: Date): RetentionPurgeOps;
}

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

export interface RetentionLock {
  /** 抢不到锁时不执行 fn。heartbeat 在持锁期间保活租约，租约丢失时抛错。 */
  runExclusive<T>(fn: (heartbeat: () => Promise<void>) => Promise<T>): Promise<LockResult<T>>;
}

export interface RetentionTaskContext {
  dryRun: boolean;
  now: Date;
  batchSize: number;
  /** 超过单轮时限后为 true，长任务应尽快收尾。 */
  shouldStop(): boolean;
  heartbeat(): Promise<void>;
  sleep(ms: number): Promise<void>;
}

/** 返回删除（dry-run 时为「将删除」）的行数。 */
export type RetentionTaskFn = (ctx: RetentionTaskContext) => Promise<number | void>;

export interface RetentionTask {
  name: string;
  run: RetentionTaskFn;
}

// ─────────────────────────── 额外任务注册 ───────────────────────────

type TaskRegistry = Map<string, RetentionTaskFn>;
const globalState = globalThis as typeof globalThis & { __silkmomoRetentionTasks?: TaskRegistry };

function registry(): TaskRegistry {
  // 挂 globalThis：instrumentation 与路由可能是不同的 bundle，各自 import 本模块会得到不同的模块实例。
  return (globalState.__silkmomoRetentionTasks ??= new Map());
}

/** 注册额外的清理函数（同名覆盖）。fn 内部自己负责分批；返回删除行数用于汇总日志。 */
export function registerRetentionTask(name: string, fn: RetentionTaskFn): void {
  if (!name || typeof fn !== 'function') throw new Error('registerRetentionTask 需要 name 和函数');
  registry().set(name, fn);
}

export function listRegisteredRetentionTasks(): RetentionTask[] {
  return [...registry().entries()].map(([name, run]) => ({ name, run }));
}

// ─────────────────────────── 核心：一轮清理 ───────────────────────────

export interface RetentionDeps {
  store: RetentionStore;
  lock: RetentionLock;
  config: RetentionConfig;
  /** 额外任务；缺省取 registerRetentionTask 注册的。 */
  extraTasks?: RetentionTask[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, data?: Record<string, unknown>) => void;
  maxRunMs?: number;
  batchPauseMs?: number;
}

export interface RetentionSummary {
  skipped?: 'disabled' | 'lock';
  dryRun: boolean;
  /** 各任务删除（dry-run 为将删除）的行数。 */
  counts: Record<string, number>;
  /** 出错的任务名 → 错误信息。其它任务不受影响。 */
  errors: Record<string, string>;
  stoppedEarly: boolean;
  durationMs: number;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 通用分批清理：列 id → 删 → 让出事件循环，直到没有可删数据。 */
async function purgeInBatches(ops: RetentionPurgeOps, ctx: RetentionTaskContext, pauseMs: number): Promise<number> {
  if (ctx.dryRun) return ops.count();
  let total = 0;
  for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_TASK; batch++) {
    if (ctx.shouldStop()) break;
    await ctx.heartbeat();
    const ids = await ops.listIds(ctx.batchSize);
    if (ids.length === 0) break;
    const deleted = await ops.deleteIds(ids);
    total += deleted;
    if (deleted === 0 || ids.length < ctx.batchSize) break; // 没删动（并发改了状态）或已是最后一批
    await ctx.sleep(pauseMs);
  }
  return total;
}

export async function runRetention(deps: RetentionDeps): Promise<RetentionSummary> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const startedAt = now();
  const config = deps.config;
  const summary: RetentionSummary = {
    dryRun: config.dryRun,
    counts: {},
    errors: {},
    stoppedEarly: false,
    durationMs: 0,
  };

  if (config.disabled) {
    summary.skipped = 'disabled';
    return summary;
  }

  const deadline = startedAt + (deps.maxRunMs ?? RETENTION_MAX_RUN_MS);
  const pauseMs = deps.batchPauseMs ?? RETENTION_BATCH_PAUSE_MS;
  const nowDate = new Date(startedAt);
  const generationCutoff = new Date(startedAt - config.generationRecordDays * DAY_MS);
  const jobCutoff = new Date(startedAt - config.modelFaceJobDays * DAY_MS);

  const lockResult = await deps.lock.runExclusive(async heartbeat => {
    const ctx: RetentionTaskContext = {
      dryRun: config.dryRun,
      now: nowDate,
      batchSize: config.batchSize,
      shouldStop: () => now() >= deadline,
      heartbeat,
      sleep,
    };

    const builtIn: RetentionTask[] = [
      { name: 'generationRecord', run: c => purgeInBatches(deps.store.generationRecords(generationCutoff), c, pauseMs) },
      { name: 'modelFaceJob', run: c => purgeInBatches(deps.store.modelFaceJobs(jobCutoff), c, pauseMs) },
    ];
    const tasks = [...builtIn, ...(deps.extraTasks ?? listRegisteredRetentionTasks())];

    for (const task of tasks) {
      try {
        const deleted = await task.run(ctx);
        summary.counts[task.name] = typeof deleted === 'number' ? deleted : 0;
      } catch (error) {
        summary.counts[task.name] = summary.counts[task.name] ?? 0;
        summary.errors[task.name] = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
        // 租约丢了就不要再往下删了（可能已有别的实例接手）
        if (error instanceof RetentionLeaseLostError) break;
      }
    }
    summary.stoppedEarly = ctx.shouldStop();
  });

  if (!lockResult.acquired) {
    summary.skipped = 'lock';
    deps.log?.('skipped_lock_held');
    summary.durationMs = now() - startedAt;
    return summary;
  }

  summary.durationMs = now() - startedAt;
  deps.log?.('done', {
    dryRun: summary.dryRun,
    ...summary.counts,
    errors: Object.keys(summary.errors).length ? summary.errors : undefined,
    stoppedEarly: summary.stoppedEarly || undefined,
    durationMs: summary.durationMs,
  });
  return summary;
}

export class RetentionLeaseLostError extends Error {
  constructor(message = 'retention advisory lock lease lost') {
    super(message);
    this.name = 'RetentionLeaseLostError';
  }
}

// ─────────────────────────── Prisma 实现 ───────────────────────────

type Args = Record<string, unknown>;
interface RetentionModelDelegate {
  findMany(args: Args): Promise<Array<{ id: string }>>;
  deleteMany(args: Args): Promise<{ count: number }>;
  count(args: Args): Promise<number>;
}

export interface RetentionPrismaClient {
  generationRecord: RetentionModelDelegate;
  modelFaceGenerationJob: RetentionModelDelegate;
  $transaction<T>(
    fn: (tx: { $queryRawUnsafe(query: string): Promise<unknown> }) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
}

function delegateOps(delegate: RetentionModelDelegate, where: Args, orderBy: Args): RetentionPurgeOps {
  return {
    count: () => delegate.count({ where }),
    async listIds(limit) {
      const rows = await delegate.findMany({ where, orderBy, take: limit, select: { id: true } });
      return rows.map(row => row.id);
    },
    // 删除时把保留条件再带一遍：列出与删除之间用户可能刚好评了分/留了反馈，或 job 又有了待退款 item。
    async deleteIds(ids) {
      const res = await delegate.deleteMany({ where: { AND: [{ id: { in: ids } }, where] } });
      return res.count;
    },
  };
}

export function createPrismaRetentionStore(prisma: RetentionPrismaClient): RetentionStore {
  return {
    generationRecords: cutoff => delegateOps(prisma.generationRecord, generationRecordRetentionWhere(cutoff), { createdAt: 'asc' }),
    modelFaceJobs: cutoff => delegateOps(prisma.modelFaceGenerationJob, modelFaceJobRetentionWhere(cutoff), { finishedAt: 'asc' }),
  };
}

/** PostgreSQL advisory lock（事务级）。租约事务只持锁，不做删除。 */
export function createAdvisoryLock(prisma: RetentionPrismaClient): RetentionLock {
  return {
    async runExclusive<T>(fn: (heartbeat: () => Promise<void>) => Promise<T>): Promise<LockResult<T>> {
      let result: LockResult<T> = { acquired: false };
      await prisma.$transaction(async tx => {
        const rows = await tx.$queryRawUnsafe(`SELECT pg_try_advisory_xact_lock(${RETENTION_ADVISORY_LOCK_KEY}) AS locked`);
        const locked = Array.isArray(rows) && (rows[0] as { locked?: unknown } | undefined)?.locked === true;
        if (!locked) return;
        const heartbeat = async () => {
          try {
            await tx.$queryRawUnsafe('SELECT 1');
          } catch (error) {
            throw new RetentionLeaseLostError(error instanceof Error ? error.message : undefined);
          }
        };
        result = { acquired: true, value: await fn(heartbeat) };
      }, { timeout: RETENTION_LOCK_LEASE_MS, maxWait: 10_000 });
      return result;
    },
  };
}

/** 非 PostgreSQL（本地 SQLite 开发）没有 advisory lock，单实例直接跑。 */
export const noopLock: RetentionLock = {
  async runExclusive<T>(fn: (heartbeat: () => Promise<void>) => Promise<T>): Promise<LockResult<T>> {
    return { acquired: true, value: await fn(async () => {}) };
  },
};

const log = (message: string, data?: Record<string, unknown>) =>
  console.log(`[retention] ${message}`, data ? JSON.stringify(data) : '');

/** 生产依赖：全部按需动态加载，避免纯逻辑被测试加载时拖进 Prisma。 */
export async function createDefaultRetentionDeps(): Promise<RetentionDeps> {
  const prismaModule = await import('./prisma');
  const prisma = prismaModule.default as unknown as RetentionPrismaClient;
  return {
    store: createPrismaRetentionStore(prisma),
    lock: prismaModule.isPostgres ? createAdvisoryLock(prisma) : noopLock,
    config: readRetentionConfig(process.env, msg => console.warn(`[retention] ${msg}`)),
    log,
  };
}

// ─────────────────────────── 调度 ───────────────────────────

function envMs(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 && process.env[name] !== undefined && process.env[name] !== '' ? parsed : fallback;
}

/**
 * instrumentation.ts 调用：启动 10 分钟后跑第一次，之后每 24 小时一次；异常吞掉只记日志；进程内只起一个定时器。
 * RETENTION_FIRST_RUN_DELAY_MS / RETENTION_INTERVAL_MS 仅用于联调验证，生产保持默认。
 */
export function startRetentionScheduler(): void {
  const state = globalThis as typeof globalThis & { __silkmomoRetentionTimer?: ReturnType<typeof setTimeout> };
  if (state.__silkmomoRetentionTimer) return;

  const config = readRetentionConfig(process.env, msg => console.warn(`[retention] ${msg}`));
  if (config.disabled) {
    log('disabled by RETENTION_DISABLED，不调度');
    return;
  }
  if (!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URI || process.env.POSTGRESQL_URL)) {
    log('未配置数据库，不调度');
    return;
  }

  const firstDelayMs = envMs('RETENTION_FIRST_RUN_DELAY_MS', RETENTION_FIRST_RUN_DELAY_MS);
  const intervalMs = Math.max(1000, envMs('RETENTION_INTERVAL_MS', RETENTION_INTERVAL_MS));

  let running = false;
  const tick = async () => {
    if (running) return; // 上一轮还没跑完就跳过，不叠加
    running = true;
    try {
      await runRetention(await createDefaultRetentionDeps());
    } catch (error) {
      console.error('[retention] 清理失败:', error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => {
    void tick();
    const timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref?.();
  }, firstDelayMs);
  first.unref?.();
  state.__silkmomoRetentionTimer = first;

  log('scheduled', {
    firstRunInMs: firstDelayMs,
    intervalMs,
    dryRun: config.dryRun,
    generationRecordDays: config.generationRecordDays,
    modelFaceJobDays: config.modelFaceJobDays,
  });
}
