/**
 * 补拉核心（纯逻辑，依赖全部注入，可被 node:test 直接加载）。
 * 真实依赖（fetch / Dexie）在 lib/pending-recovery.ts 里装配。
 */
import type { PendingFetchOutcome } from './pending-fetch';

export interface PendingMeta {
  id: string;
  kind: string;
  shotIndex: number;
  width: number;
  height: number;
}

/** 补拉用到的本地图片字段（ImageItem 的子集） */
export interface RecoverableImage {
  id?: number;
  projectId: number;
  type: string;
  data: string;
  mimeType: string;
  shotIndex?: number;
  imageType?: string;
  index?: number;
}

export interface PendingRecoveryStore {
  list(taskId: number): Promise<RecoverableImage[]>;
  add(image: RecoverableImage): Promise<unknown>;
  setType(id: number, type: string): Promise<unknown>;
  remove(id: number): Promise<unknown>;
}

export interface PendingRecoveryDeps {
  /** 列出该任务下服务端还留着的待取图元信息；失败直接 throw */
  listPending(taskId: number, signal: AbortSignal): Promise<PendingMeta[]>;
  fetchImage(pendingId: string): Promise<PendingFetchOutcome>;
  /** 通知服务端删缓冲行（fire-and-forget，删不掉由 TTL 兜底） */
  release(pendingId: string): void;
  store: PendingRecoveryStore;
  sleep(ms: number): Promise<void>;
  attempts: number;
  listTimeoutMs: number;
  log: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export interface PendingRecoveryResult {
  ok: boolean;
  recoveredShotIndexes: number[];
}

// 同一任务的补拉串行执行：任务页进入、重做前后、生成收尾都会各自补拉一次，几路同时跑会
// 对同一批 pending 各自「取图—落库」，本地快照互不可见 → 同一镜次被重复入库。
const taskQueues = new Map<number, Promise<unknown>>();

function runExclusive<T>(taskId: number, job: () => Promise<T>): Promise<T> {
  const previous = taskQueues.get(taskId) ?? Promise.resolve();
  const next = previous.then(job, job);
  const tail = next.catch(() => undefined);
  taskQueues.set(taskId, tail);
  void tail.then(() => {
    if (taskQueues.get(taskId) === tail) taskQueues.delete(taskId);
  });
  return next;
}

/**
 * 补拉：把服务端还留着、本地却没有的图捡回来。
 *
 * 这条路径专治「图已生成成功但没送达」：以前那种情况图就永久丢了（用户只能重新生成并再付
 * 一次钱），现在服务端会把图留在交接缓冲里，进任务页就能补回来。
 * 幂等：同一 shotIndex 本地已有 result 且内容一致才视为重复；内容不同＝新付费的图，旧图降级为备份。
 *
 * 「待取图片已被取走」（取图 404）不是失败：SSE 正常交付路径落库后会立刻 DELETE 这条 pending，
 * 补拉列表若恰好在 DELETE 之前取得，随后的取图就会 404。这说明另一条路径已经把它收进本地，
 * 这里直接跳过——不重试、不计失败、不动本地任何数据。
 */
export function recoverPending(
  deps: PendingRecoveryDeps,
  taskId: number,
  expectedShotIndexes: readonly number[] = [],
): Promise<PendingRecoveryResult> {
  return runExclusive(taskId, () => recoverPendingOnce(deps, taskId, expectedShotIndexes));
}

async function recoverPendingOnce(
  deps: PendingRecoveryDeps,
  taskId: number,
  expectedShotIndexes: readonly number[],
): Promise<PendingRecoveryResult> {
  const { store, log } = deps;
  const recoveredShotIndexes: number[] = [];
  for (let attempt = 0; attempt < deps.attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.listTimeoutMs);
    try {
      const images = await deps.listPending(taskId, controller.signal);
      if (!Array.isArray(images)) throw new Error('响应缺少待取图片列表');

      const local = await store.list(taskId);
      for (const meta of images) {
        if (meta.kind === 'anchor') {
          const existingAnchor = local.find(i => i.type === 'anchor');
          if (existingAnchor) {
            deps.release(meta.id);
            continue;
          }
          const anchorOutcome = await deps.fetchImage(meta.id);
          if (anchorOutcome.status === 'gone') {
            log.log(`[交接缓冲] 身份锚 ${meta.id} 已被另一条路径取走，跳过`);
            continue;
          }
          if (anchorOutcome.status === 'failed') {
            log.error(`[交接缓冲] 身份锚 ${meta.id} 未能取回，继续并回退首张成功图`);
            continue;
          }
          const fetchedAnchor = anchorOutcome.image;
          try {
            await store.add({
              projectId: taskId,
              type: 'anchor',
              data: fetchedAnchor.data,
              mimeType: fetchedAnchor.mimeType || 'image/png',
            });
            local.push({
              projectId: taskId,
              type: 'anchor',
              data: fetchedAnchor.data,
              mimeType: fetchedAnchor.mimeType || 'image/png',
            });
            deps.release(meta.id);
          } catch (error) {
            log.error('[交接缓冲] 身份锚落库失败，继续并回退首张成功图:', error);
          }
          continue;
        }
        const persistedShotIndex = meta.shotIndex > 0 ? meta.shotIndex : undefined;
        const existingResult = local.find(i => i.type === 'result' && i.shotIndex === persistedShotIndex);
        // 本地同镜次已有 result，不等于这张 pending 是它的重复：
        // 用户重做某镜次并付费后，若这一轮没送达，生成收尾会先把旧图（result_backup）还原成 result，
        // 随后补拉发现「同 shotIndex 已有 result」——旧逻辑直接 DELETE，等于把刚付费的新图丢了。
        // 所以先把 pending 取回来比对内容：一模一样才是重复（释放即可）；不一样就是新付费的图，
        // 旧图降级为 result_backup（保留可还原），新图作为 result 入库。
        const outcome = await deps.fetchImage(meta.id);
        if (outcome.status === 'gone') {
          // 已被取走：另一条路径（SSE 正常交付 / 另一轮补拉）已经处理，什么都不做。
          log.log(`[交接缓冲] 待取图片 ${meta.id} 已被另一条路径取走，跳过`);
          continue;
        }
        if (outcome.status === 'failed') throw new Error(`待取图片 ${meta.id} 未能取回`);
        const fetched = outcome.image;
        if (existingResult) {
          if (existingResult.data === fetched.data) {
            deps.release(meta.id);
            continue;
          }
          const staleBackups = (await store.list(taskId))
            .filter(i => i.type === 'result_backup' && i.shotIndex === persistedShotIndex);
          for (const backup of staleBackups) {
            if (backup.id !== undefined) await store.remove(backup.id);
          }
          if (existingResult.id !== undefined) {
            await store.setType(existingResult.id, 'result_backup');
          }
          existingResult.type = 'result_backup';
        }
        await store.add({
          projectId: taskId,
          type: 'result',
          data: fetched.data,
          mimeType: fetched.mimeType || 'image/png',
          shotIndex: persistedShotIndex,
          imageType: 'hero',
          index: meta.shotIndex,
        });
        local.push({
          projectId: taskId,
          type: 'result',
          data: fetched.data,
          mimeType: fetched.mimeType || 'image/png',
          shotIndex: persistedShotIndex,
        });
        recoveredShotIndexes.push(meta.shotIndex);
        deps.release(meta.id);
      }

      if (expectedShotIndexes.length > 0) {
        // 仅诊断：缺口的补齐交给生成路径（recoveryGate / finalizeGeneration），这里不据此改库
        const haveShots = new Set(local.filter(i => i.type === 'result').map(i => i.shotIndex ?? 0));
        const stillMissing = expectedShotIndexes.filter(shot => !haveShots.has(shot));
        if (stillMissing.length > 0) {
          log.log(`[交接缓冲] 补拉后本地仍缺镜次 ${stillMissing.join(',')}，交给生成路径处理`);
        }
      }
      if (recoveredShotIndexes.length > 0) {
        log.log(`[交接缓冲] 补回 ${recoveredShotIndexes.length} 张此前未送达的图`);
      }
      // 列表成功且其中的结果都已处理，说明当前没有更多可补；缺口应交给生成路径，
      // 不能为了等一个尚不存在的 pending 固定空转三轮。
      return { ok: true, recoveredShotIndexes };
    } catch (err) {
      log.error(`[交接缓冲] 补拉失败(${attempt + 1}/${deps.attempts}):`, err);
      if (attempt === deps.attempts - 1) {
        return { ok: false, recoveredShotIndexes };
      }
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < deps.attempts - 1) {
      await deps.sleep(1000 * (attempt + 1));
    }
  }
  return { ok: true, recoveredShotIndexes };
}
