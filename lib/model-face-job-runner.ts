export interface ChargedModelFaceInput {
  userId: string;
  specIndex: number;
  costFen: number;
}

interface DeductionResult { success: boolean; error?: string }
interface GenerationResult { success: boolean; data?: string; mimeType?: string; error?: string }
interface StoredFace { id: string }

export interface ChargedModelFaceDependencies {
  deduct(input: ChargedModelFaceInput): Promise<DeductionResult>;
  generate(input: ChargedModelFaceInput): Promise<GenerationResult>;
  store(input: ChargedModelFaceInput & { data: string; mimeType: string }): Promise<StoredFace>;
  refund(input: ChargedModelFaceInput & { reason: string }): Promise<{ success: boolean; error?: string }>;
}

export type ChargedModelFaceResult =
  | { status: 'succeeded'; faceId: string; costFen: number }
  | { status: 'failed'; error: string; refunded: boolean }
  | { status: 'blocked'; error: string };

/** 先预扣单张价格；仅生成并落库成功时保留扣款，其余路径全部退款。 */
export async function generateChargedModelFace(
  input: ChargedModelFaceInput,
  deps: ChargedModelFaceDependencies,
): Promise<ChargedModelFaceResult> {
  const deduction = await deps.deduct(input);
  if (!deduction.success) return { status: 'blocked', error: deduction.error || '余额不足' };

  try {
    const generated = await deps.generate(input);
    if (!generated.success || !generated.data) {
      const reason = generated.error || '模特脸生成失败';
      const refund = await deps.refund({ ...input, reason });
      return { status: 'failed', error: reason, refunded: refund.success };
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
      const refund = await deps.refund({ ...input, reason });
      return { status: 'failed', error: reason, refunded: refund.success };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '模特脸生成异常';
    const refund = await deps.refund({ ...input, reason });
    return { status: 'failed', error: reason, refunded: refund.success };
  }
}
