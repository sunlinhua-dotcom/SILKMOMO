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
      select: { userId: true; type: true; balanceAfter: true };
    }): Promise<{ userId: string; type: string; balanceAfter: number } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
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

export async function deductGenerationBalanceInTransaction(
  tx: GenerationBillingTransaction,
  input: GenerationDeductionInput,
): Promise<{ balanceAfter: number; idempotent: boolean }> {
  if (input.idempotencyKey) {
    const existing = await tx.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { userId: true, type: true, balanceAfter: true },
    });
    if (existing) {
      if (existing.userId !== input.userId || existing.type !== 'consume') {
        throw new Error('幂等键冲突');
      }
      return { balanceAfter: existing.balanceAfter, idempotent: true };
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
  await tx.transaction.create({
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
  return { balanceAfter: after.balanceFen, idempotent: false };
}
