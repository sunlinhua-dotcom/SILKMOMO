export interface PendingGenerationDelivery {
  id: string;
  width: number;
  height: number;
}

export async function resolveIdempotentGeneration(input: {
  findPending: () => Promise<PendingGenerationDelivery | null>;
  wait?: (attempt: number) => Promise<void>;
  attempts?: number;
}): Promise<
  | { action: 'redeliver'; pending: PendingGenerationDelivery }
  | { action: 'generate' }
> {
  const attempts = input.attempts ?? 4;
  const wait = input.wait ?? (attempt => new Promise(resolve => setTimeout(resolve, attempt * 250)));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const pending = await input.findPending();
    if (pending) return { action: 'redeliver', pending };
    if (attempt < attempts) await wait(attempt);
  }
  // 赢家事务可能刚落 consume、pending 仍在生成中。此请求沿用该次已扣费用继续生成，
  // 比把用户永久卡在“请刷新取回”安全；pending 唯一键仍会阻止两份结果都占用交接行。
  return { action: 'generate' };
}
