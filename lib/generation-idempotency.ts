export interface PendingGenerationDelivery {
  id: string;
  width: number;
  height: number;
}

/**
 * 路由 `maxDuration`（秒）。路由里的 `export const maxDuration` 必须是字面量（Next 静态分析），
 * 所以这里是镜像常量，由 __tests__/generation-billing-replay.test.mjs 校验两者一致。
 */
export const GENERATION_MAX_DURATION_SECONDS = 800;

/** 前一个请求「可能还在跑」的窗口：路由最长存活 + 60s 余量。超出仍未履约 = 孤儿。 */
export const GENERATION_IN_FLIGHT_WINDOW_MS = (GENERATION_MAX_DURATION_SECONDS + 60) * 1000;

/**
 * 孤儿清扫的年龄门槛（20 分钟）。必须大于在途窗口，否则清扫会退掉还在正常生成的请求；
 * 窗口与门槛之间（约 14~20 分钟）的幂等命中只提示、不生成，等清扫统一退款。
 */
export const GENERATION_ORPHAN_AGE_MS = 20 * 60 * 1000;

/** 出图幂等键：`${userId}:${taskId}:${shotIndex}:${runId}`。无 runId 的老客户端没有键。 */
export function generationIdempotencyKey(
  userId: string,
  taskId: number,
  shotIndex: number,
  runId: string | undefined,
): string | undefined {
  return runId ? `${userId}:${taskId}:${shotIndex}:${runId}` : undefined;
}

/**
 * 只认出图幂等键的结构：`<userId>:<taskId>:<shotIndex>:<runId>`。
 * 脸库计费键是 `<billingKey>:charge|refund`（只有一个冒号），AI 助手没有键，都不会命中。
 * 同样的正则在 lib/billing-reconcile.ts 的 SQL 里原样使用（Postgres `~`）。
 */
export const GENERATION_IDEMPOTENCY_KEY_REGEX_SOURCE = '^[^:]+:[0-9]+:[0-9]+:[A-Za-z0-9_-]{8,100}$';
const GENERATION_IDEMPOTENCY_KEY_PATTERN = new RegExp(GENERATION_IDEMPOTENCY_KEY_REGEX_SOURCE);

export function isGenerationIdempotencyKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && GENERATION_IDEMPOTENCY_KEY_PATTERN.test(key);
}

export type IdempotentGenerationResolution =
  /** 结果还在 pending 里：补发 id 即可。 */
  | { action: 'redeliver'; pending: PendingGenerationDelivery }
  /** 已履约（结果交付过，客户端已取走或已删）：绝不再生成。 */
  | { action: 'already-delivered' }
  /** 未履约、仍在在途窗口内，轮询后 pending 还没出现：前一个请求大概率还在跑，不生成。 */
  | { action: 'in-flight' }
  /** 未履约、超出窗口：孤儿，等清扫退款，本请求不生成。 */
  | { action: 'orphan' };

/**
 * 幂等命中既有 consume 后怎么办。**任何分支都不会返回「继续生成」**——
 * 旧实现找不到 pending 就沿用旧扣费继续出图，用户 DELETE 自己的 pending 后用同一 runId
 * 就能无限免费重放（P0）。现在「再生成」只发生在 deduct 真的新扣了一笔钱之后。
 */
export async function resolveIdempotentGeneration(input: {
  findPending: () => Promise<PendingGenerationDelivery | null>;
  /** 既有 consume 的履约时间；空 = 未履约。 */
  fulfilledAt: Date | null | undefined;
  /** 既有 consume 的创建时间；取不到按「刚创建」处理（保守＝不当孤儿）。 */
  createdAt: Date | null | undefined;
  now?: () => number;
  inFlightWindowMs?: number;
  wait?: (attempt: number) => Promise<void>;
  attempts?: number;
}): Promise<IdempotentGenerationResolution> {
  const attempts = input.attempts ?? 4;
  const wait = input.wait ?? (attempt => new Promise<void>(resolve => setTimeout(resolve, attempt * 250)));

  // 有 pending 就补发（含「写完 pending 但履约标记没写成」）。
  const first = await input.findPending();
  if (first) return { action: 'redeliver', pending: first };

  if (input.fulfilledAt) return { action: 'already-delivered' };

  const now = (input.now ?? Date.now)();
  const windowMs = input.inFlightWindowMs ?? GENERATION_IN_FLIGHT_WINDOW_MS;
  const ageMs = input.createdAt ? now - input.createdAt.getTime() : 0;
  if (ageMs > windowMs) return { action: 'orphan' };

  // 前一个请求可能刚落 consume、pending 仍在生成：短轮询等一会儿。
  for (let attempt = 1; attempt < attempts; attempt++) {
    await wait(attempt);
    const pending = await input.findPending();
    if (pending) return { action: 'redeliver', pending };
  }
  return { action: 'in-flight' };
}

/** 幂等命中却不生成时给用户看的话（非 fatal，其余镜次不受影响）。 */
export const IDEMPOTENT_BLOCKED_MESSAGES = {
  'already-delivered': '该镜次已生成并交付过，如未看到请刷新页面',
  'in-flight': '上一次请求仍在生成中，请稍后刷新取回',
  orphan: '上一次请求未完成，系统会自动退款，请稍后重新生成',
} as const;
