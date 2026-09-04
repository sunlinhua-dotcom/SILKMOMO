export interface GenerationDeductionInput {
  userId: string;
  costFen: number;
  description: string;
  projectId?: number;
  apiModel: string;
  idempotencyKey?: string;
}
interface GenerationBillingTransaction {
  transaction: {
    findUnique(args: {
      where: { idempotencyKey: string };
      select: { id: true; userId: true; type: true; balanceAfter: true };
    }): Promise<{ id: string; userId: string; type: string; balanceAfter: number } | null>;
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

export async function deductGenerationBalanceInTransaction(
  tx: GenerationBillingTransaction,
  input: GenerationDeductionInput,
): Promise<{ balanceAfter: number; idempotent: boolean; consumeTransactionId: string }> {
  if (input.idempotencyKey) {
    const existing = await tx.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, userId: true, type: true, balanceAfter: true },
    });
    if (existing) {
      if (existing.userId !== input.userId || existing.type !== 'consume') {
        throw new Error('幂等键冲突');
      }
      return {
        balanceAfter: existing.balanceAfter,
        idempotent: true,
        consumeTransactionId: existing.id,
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
