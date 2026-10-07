export interface GenerationDeductionInput {
  userId: string;
  costFen: number;
  description: string;
  projectId?: number;
  apiModel: string;
  idempotencyKey?: string;
  /**
   * 出图类扣费：fulfilledAt 留空，等「结果已写入 pending / 已推给客户端」后由路由写入；
   * 进程被杀留下的孤儿由 lib/billing-reconcile.ts 清扫退款。仅在带幂等键时生效——
   * 没有键就无法幂等退款，不留空，免得清扫索引里堆无用行。其余扣费创建即视为已履约。
   */
  awaitFulfillment?: boolean;
}
interface GenerationBillingTransaction {
  transaction: {
    findUnique(args: {
      where: { idempotencyKey: string };
      select: { id: true; userId: true; type: true; balanceAfter: true; fulfilledAt: true; createdAt: true };
    }): Promise<{
      id: string;
      userId: string;
      type: string;
      balanceAfter: number;
      fulfilledAt?: Date | null;
      createdAt?: Date | null;
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  user: {
    updateMany(args: {
      where: { id: string; balanceFen: { gte: number } };
      data: { balanceFen: { decrement: number } };
    }): Promise<{ count: number }>;
    findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
    findUniqueOrThrow(args: { where: { id: string }; select: { balanceFen: true } }): Promise<{ balanceFen: number }>;
  };
}

interface GenerationRefundTransaction {
  transaction: {
    updateMany(args: {
      where: { id: string; userId: string; type: string; idempotencyKey: string };
      data: { idempotencyKey: null };
    }): Promise<{ count: number }>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  user: {
    update(args: {
      where: { id: string };
      data: { balanceFen: { increment: number } };
    }): Promise<{ balanceFen: number }>;
    findUniqueOrThrow(args: {
      where: { id: string };
      select: { balanceFen: true };
    }): Promise<{ balanceFen: number }>;
  };
}

export interface GenerationRefundInput {
  userId: string;
  amountFen: number;
  description: string;
  projectId?: number;
  idempotencyKey?: string;
  consumeTransactionId?: string;
}

/** 可以原样展示给用户的扣费失败原因；其余（Prisma / 连接串 / SQL 原文）一律不透传。 */
const SAFE_BILLING_ERRORS = new Set(['余额不足', '用户不存在', '扣费金额非法', '幂等键冲突']);
export const GENERIC_BILLING_ERROR = '扣费系统暂时不可用，请稍后重试';

export function toSafeBillingError(error: unknown, fallback = GENERIC_BILLING_ERROR): string {
  const message = error instanceof Error ? error.message : '';
  return SAFE_BILLING_ERRORS.has(message) ? message : fallback;
}

export interface RefundRetryOptions {
  /** 首次失败后的重试次数，默认 3。 */
  retries?: number;
  /** 首个退避间隔，之后每次翻倍（默认 300ms → 600 → 1200）。 */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** 进程内指数退避重试：退款失败等于用户的钱蒸发，值得多试几次再放弃。 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RefundRetryOptions = {},
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number }> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return { ok: true, value: await operation(), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  return { ok: false, error: lastError, attempts: retries + 1 };
}

export function formatGenerationDeductionError(
  error: string | undefined,
  balanceFen: number,
  stopped: boolean,
): string {
  if (error === '余额不足') {
    return `余额不足（当前 ¥${(balanceFen / 100).toFixed(2)}）${stopped ? '，已停止生成' : ''}`;
  }
  return `扣费失败: ${error || '未知错误'}`;
}

export interface GenerationDeductionResult {
  balanceAfter: number;
  idempotent: boolean;
  consumeTransactionId: string;
  /** 仅幂等命中时返回：既有 consume 的履约时间（空 = 尚未履约）与创建时间，供调用方判断在途 / 孤儿。 */
  fulfilledAt?: Date | null;
  createdAt?: Date | null;
}

export async function deductGenerationBalanceInTransaction(
  tx: GenerationBillingTransaction,
  input: GenerationDeductionInput,
): Promise<GenerationDeductionResult> {
  if (input.idempotencyKey) {
    const existing = await tx.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, userId: true, type: true, balanceAfter: true, fulfilledAt: true, createdAt: true },
    });
    if (existing) {
      if (existing.userId !== input.userId || existing.type !== 'consume') {
        throw new Error('幂等键冲突');
      }
      return {
        balanceAfter: existing.balanceAfter,
        idempotent: true,
        consumeTransactionId: existing.id,
        fulfilledAt: existing.fulfilledAt ?? null,
        createdAt: existing.createdAt ?? null,
      };
    }
  }

  const updated = await tx.user.updateMany({
    where: { id: input.userId, balanceFen: { gte: input.costFen } },
    data: { balanceFen: { decrement: input.costFen } },
  });
  if (updated.count === 0) {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) throw new Error('用户不存在');
    throw new Error('余额不足');
  }
  const after = await tx.user.findUniqueOrThrow({
    where: { id: input.userId },
    select: { balanceFen: true },
  });
  const consume = await tx.transaction.create({
    data: {
      userId: input.userId,
      type: 'consume',
      amountFen: -input.costFen,
      balanceAfter: after.balanceFen,
      description: input.description,
      apiModel: input.apiModel,
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      fulfilledAt: input.awaitFulfillment && input.idempotencyKey ? null : new Date(),
    },
  });
  return { balanceAfter: after.balanceFen, idempotent: false, consumeTransactionId: consume.id };
}

export async function refundGenerationBalanceInTransaction(
  tx: GenerationRefundTransaction,
  input: GenerationRefundInput,
): Promise<{ balanceAfter: number }> {
  if (input.idempotencyKey && !input.consumeTransactionId) {
    throw new Error('幂等退款缺少消费流水 ID');
  }
  if (input.idempotencyKey && input.consumeTransactionId) {
    const claimed = await tx.transaction.updateMany({
      where: {
        id: input.consumeTransactionId,
        userId: input.userId,
        type: 'consume',
        idempotencyKey: input.idempotencyKey,
      },
      data: { idempotencyKey: null },
    });
    if (claimed.count === 0) {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { balanceFen: true },
      });
      return { balanceAfter: current.balanceFen };
    }
  }

  const updated = await tx.user.update({
    where: { id: input.userId },
    data: { balanceFen: { increment: input.amountFen } },
  });

  await tx.transaction.create({
    data: {
      userId: input.userId,
      type: 'refund',
      amountFen: input.amountFen,
      balanceAfter: updated.balanceFen,
      description: input.description,
      projectId: input.projectId,
    },
  });

  return { balanceAfter: updated.balanceFen };
}
