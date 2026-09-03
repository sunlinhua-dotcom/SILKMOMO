export type ModelFaceBillingState =
  | 'uncharged'
  | 'charged'
  | 'refund_pending'
  | 'refunded'
  | 'kept';

export interface ChargedModelFaceInput {
  userId: string;
  specIndex: number;
  costFen: number;
  billingStatus: ModelFaceBillingState;
}

interface BillingResult {
  success: boolean;
  status?: ModelFaceBillingState;
  error?: string;
}

interface GenerationResult { success: boolean; data?: string; mimeType?: string; error?: string }
interface StoredFace { id: string }

export interface ChargedModelFaceDependencies {
  deduct(input: ChargedModelFaceInput): Promise<BillingResult>;
  markAttempt(input: ChargedModelFaceInput): Promise<{ success: boolean; error?: string }>;
  generate(input: ChargedModelFaceInput): Promise<GenerationResult>;
  store(input: ChargedModelFaceInput & { data: string; mimeType: string }): Promise<StoredFace>;
  refund(input: ChargedModelFaceInput & { reason: string }): Promise<BillingResult>;
}

export type ChargedModelFaceResult =
  | { status: 'succeeded'; faceId: string; costFen: number }
  | { status: 'failed'; error: string; refundStatus: 'refunded' | 'refund_pending' }
  | { status: 'blocked'; error: string };

export function buildModelFaceJobError(failedCount: number, pendingRefunds: number): string | null {
  if (pendingRefunds > 0) return `${failedCount} 张失败，${pendingRefunds} 张退款处理中`;
  return failedCount > 0 ? `${failedCount} 张失败，已退款` : null;
}

async function refundFailure(
  input: ChargedModelFaceInput,
  deps: ChargedModelFaceDependencies,
  reason: string,
): Promise<ChargedModelFaceResult> {
  const refund = await deps.refund({ ...input, reason });
  return {
    status: 'failed',
    error: reason,
    refundStatus: refund.success && refund.status !== 'refund_pending'
      ? 'refunded'
      : 'refund_pending',
  };
}

/**
 * A persisted `charged` state means the debit already committed in the same DB
 * transaction. Recovery therefore skips deduction instead of charging twice.
 */
export async function generateChargedModelFace(
  input: ChargedModelFaceInput,
  deps: ChargedModelFaceDependencies,
): Promise<ChargedModelFaceResult> {
  if (input.billingStatus === 'uncharged') {
    const deduction = await deps.deduct(input);
    if (!deduction.success) return { status: 'blocked', error: deduction.error || '余额不足' };
  } else if (input.billingStatus !== 'charged') {
    return { status: 'blocked', error: '该图片计费状态不可生成' };
  }

  const attempted = await deps.markAttempt(input);
  if (!attempted.success) {
    return refundFailure(input, deps, attempted.error || '今日生成次数已达上限');
  }

  try {
    const generated = await deps.generate(input);
    if (!generated.success || !generated.data) {
      return refundFailure(input, deps, generated.error || '模特脸生成失败');
    }

    try {
      const face = await deps.store({
        ...input,
        data: generated.data,
        mimeType: generated.mimeType || 'image/png',
      });
      return { status: 'succeeded', faceId: face.id, costFen: input.costFen };
    } catch (error) {
      const reason = error instanceof Error ? error.message : '模特脸落库失败';
      return refundFailure(input, deps, reason);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '模特脸生成异常';
    return refundFailure(input, deps, reason);
  }
}

export interface InterruptedModelFaceItem {
  billingStatus: ModelFaceBillingState;
  attemptedAt: Date | null;
  faceId: string | null;
}

/** Decide the only safe recovery transition before another upstream call. */
export async function reconcileInterruptedModelFaceItem(
  item: InterruptedModelFaceItem,
  deps: { refund(): Promise<BillingResult> },
): Promise<{ itemStatus: 'pending' | 'succeeded' | 'failed'; billingStatus: ModelFaceBillingState }> {
  if (item.billingStatus === 'kept' && item.faceId) {
    return { itemStatus: 'succeeded', billingStatus: 'kept' };
  }
  if (item.billingStatus === 'refunded') {
    return { itemStatus: 'failed', billingStatus: 'refunded' };
  }
  if (item.billingStatus === 'refund_pending' || (item.billingStatus === 'charged' && item.attemptedAt)) {
    const refund = await deps.refund();
    return refund.success
      ? { itemStatus: 'failed', billingStatus: 'refunded' }
      : { itemStatus: 'failed', billingStatus: 'refund_pending' };
  }
  return { itemStatus: 'pending', billingStatus: item.billingStatus };
}

interface LeaseHeartbeatOptions {
  intervalMs: number;
  renew(): Promise<boolean>;
  setIntervalFn?: (callback: () => Promise<void>, intervalMs: number) => unknown;
  clearIntervalFn?: (timer: unknown) => void;
}

/** A tiny injectable heartbeat makes lease-loss behavior testable without a database clock. */
export function createModelFaceLeaseHeartbeat(options: LeaseHeartbeatOptions) {
  let lost = false;
  const setIntervalFn = options.setIntervalFn
    ?? ((callback, intervalMs) => setInterval(() => { void callback(); }, intervalMs));
  const clearIntervalFn = options.clearIntervalFn ?? (timer => clearInterval(timer as ReturnType<typeof setInterval>));
  const timer = setIntervalFn(async () => {
    try {
      if (!await options.renew()) lost = true;
    } catch {
      // A transient renewal failure does not prove lease loss; the fenced write will.
    }
  }, options.intervalMs);
  return {
    leaseLost: () => lost,
    stop: () => clearIntervalFn(timer),
  };
}
