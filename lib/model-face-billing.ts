import prisma from './prisma';
import type { ModelFaceBillingStatus } from '@prisma/client';
import {
  chargeModelFaceItemInTransaction,
  refundModelFaceItemInTransaction,
} from './model-face-billing-core';

interface BillingResult {
  success: boolean;
  status: ModelFaceBillingStatus;
  balanceAfter: number;
  error?: string;
}

export async function chargeModelFaceItem(
  itemId: string,
  description: string,
  apiModel: string,
): Promise<BillingResult> {
  try {
    return await prisma.$transaction(tx => (
      chargeModelFaceItemInTransaction(tx, itemId, description, apiModel)
    ));
  } catch (error) {
    return {
      success: false,
      status: 'uncharged',
      balanceAfter: 0,
      error: error instanceof Error ? error.message : '扣费失败',
    };
  }
}

export async function refundModelFaceItem(itemId: string, description: string): Promise<BillingResult> {
  try {
    return await prisma.$transaction(tx => (
      refundModelFaceItemInTransaction(tx, itemId, description)
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : '退款失败';
    await prisma.modelFaceGenerationItem.updateMany({
      where: { id: itemId, billingStatus: 'charged' },
      data: { billingStatus: 'refund_pending' },
    }).catch(() => undefined);
    console.error('[model-face-billing] 退款待重试', { itemId, error: message });
    return { success: false, status: 'refund_pending', balanceAfter: 0, error: message };
  }
}
