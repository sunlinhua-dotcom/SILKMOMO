export type PendingDeliveryKind = 'result' | 'anchor';

export function pendingKindsForList(includeAnchor: boolean): PendingDeliveryKind[] {
  return includeAnchor ? ['result', 'anchor'] : ['result'];
}

export function limitWithHasMore<T>(rows: readonly T[], limit: number): {
  records: T[];
  hasMore: boolean;
} {
  return {
    records: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}

export interface PendingDeliveryInput {
  kind: PendingDeliveryKind;
  userId: string;
  taskId: number;
  shotIndex: number;
  data: string;
  mimeType: string;
  width: number;
  height: number;
  idempotencyKey?: string;
}
export async function preparePendingDelivery(
  store: (input: PendingDeliveryInput) => Promise<string | null>,
  input: PendingDeliveryInput,
): Promise<{ pendingId: string | null; payload: { pendingId: string } | { imageData: string; mimeType: string } }> {
  const pendingId = await store(input);
  return {
    pendingId,
    payload: pendingId
      ? { pendingId }
      : { imageData: input.data, mimeType: input.mimeType },
  };
}
