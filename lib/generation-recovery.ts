export const PAID_IMAGE_RECOVERY_ERROR = '有已付费的图未取回，请刷新后再试';

export function mergeRecoveredShots(
  successfulShots: ReadonlySet<number>,
  recoveredShotIndexes: readonly number[],
  expectedShots: readonly number[],
): Set<number> {
  const expected = new Set(expectedShots);
  const merged = new Set(successfulShots);
  for (const shotIndex of recoveredShotIndexes) {
    if (expected.has(shotIndex)) merged.add(shotIndex);
  }
  return merged;
}
export function missingShotIndexes(
  expectedShots: readonly number[],
  successfulShots: ReadonlySet<number>,
): number[] {
  return expectedShots.filter(shotIndex => !successfulShots.has(shotIndex));
}

export function reconcileStalledChunk(input: {
  successfulShots: ReadonlySet<number>;
  recoveredShotIndexes: readonly number[];
  expectedShots: readonly number[];
  stalledChunkShots: readonly number[];
}): {
  successfulShots: Set<number>;
  unresolvedChunkShots: number[];
  fatal: false;
  continueChunks: true;
} {
  const successfulShots = mergeRecoveredShots(
    input.successfulShots,
    input.recoveredShotIndexes,
    input.expectedShots,
  );
  return {
    successfulShots,
    unresolvedChunkShots: missingShotIndexes(input.stalledChunkShots, successfulShots),
    fatal: false,
    continueChunks: true,
  };
}

export function shouldScheduleAutomaticFill(input: {
  remaining: readonly number[];
  lastErrorWasStall: boolean;
  fatalStop: boolean;
  alreadyRetried: boolean;
}): boolean {
  return input.remaining.length > 0
    && input.lastErrorWasStall
    && !input.fatalStop
    && !input.alreadyRetried;
}

export function mergeRunLocalResults(input: {
  successfulShots: ReadonlySet<number>;
  localShotIndexes: readonly number[];
  expectedShots: readonly number[];
  restoredShotIndexes: ReadonlySet<number>;
}): Set<number> {
  return mergeRecoveredShots(
    input.successfulShots,
    input.localShotIndexes.filter(shotIndex => !input.restoredShotIndexes.has(shotIndex)),
    input.expectedShots,
  );
}

export function finalizeGeneration(input: {
  expectedShots: readonly number[];
  successfulShots: ReadonlySet<number>;
  lastError: string | null;
  lastErrorWasStall: boolean;
}): { status: 'completed' | 'failed'; remaining: number[]; lastError: string | undefined } {
  const remaining = missingShotIndexes(input.expectedShots, input.successfulShots);
  const status = input.successfulShots.size > 0 ? 'completed' : 'failed';
  return {
    status,
    remaining,
    lastError: remaining.length === 0
      ? undefined
      : input.lastError || (status === 'failed' ? '生成失败（未捕获具体原因）' : undefined),
  };
}

export function recoveryGate(recovery: {
  ok: boolean;
  recoveredShotIndexes: number[];
}): { proceed: false; message: string } | { proceed: true; recoveredShotIndexes: number[] } {
  if (!recovery.ok) return { proceed: false, message: PAID_IMAGE_RECOVERY_ERROR };
  return { proceed: true, recoveredShotIndexes: recovery.recoveredShotIndexes };
}
