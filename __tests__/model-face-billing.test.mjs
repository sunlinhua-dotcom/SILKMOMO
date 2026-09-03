import assert from 'node:assert/strict';
import test from 'node:test';

const billingCore = await import('../lib/model-face-billing-core.ts').catch(() => ({}));

function createMockPrismaTransaction() {
  const state = {
    billingStatus: 'uncharged',
    billingKey: 'billing-item-1',
    balanceFen: 500,
    ledgers: [],
  };
  const tx = {
    modelFaceGenerationItem: {
      findUniqueOrThrow: async () => ({
        billingKey: state.billingKey,
        billingStatus: state.billingStatus,
        job: { userId: 'u1', costFen: 120 },
      }),
      updateMany: async ({ where, data }) => {
        const allowed = Array.isArray(where.billingStatus?.in)
          ? where.billingStatus.in.includes(state.billingStatus)
          : where.billingStatus === state.billingStatus;
        if (!allowed) return { count: 0 };
        state.billingStatus = data.billingStatus;
        return { count: 1 };
      },
      update: async ({ data }) => {
        state.billingStatus = data.billingStatus;
        return { id: 'item-1' };
      },
    },
    user: {
      updateMany: async ({ where, data }) => {
        if (state.balanceFen < where.balanceFen.gte) return { count: 0 };
        state.balanceFen -= data.balanceFen.decrement;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ balanceFen: state.balanceFen }),
      update: async ({ data }) => {
        state.balanceFen += data.balanceFen.increment;
        return { balanceFen: state.balanceFen };
      },
    },
    transaction: {
      create: async ({ data }) => {
        assert.ok(!state.ledgers.some(row => row.idempotencyKey === data.idempotencyKey));
        state.ledgers.push(data);
        return data;
      },
    },
  };
  return { state, tx };
}

test('mock Prisma proves repeated charge and refund calls change balance exactly once', async () => {
  assert.equal(typeof billingCore.chargeModelFaceItemInTransaction, 'function');
  assert.equal(typeof billingCore.refundModelFaceItemInTransaction, 'function');
  const { state, tx } = createMockPrismaTransaction();

  const firstCharge = await billingCore.chargeModelFaceItemInTransaction(tx, 'item-1', 'charge', 'gpt-image-1');
  const secondCharge = await billingCore.chargeModelFaceItemInTransaction(tx, 'item-1', 'charge', 'gpt-image-1');
  assert.equal(firstCharge.status, 'charged');
  assert.equal(secondCharge.status, 'charged');
  assert.equal(state.balanceFen, 380);
  assert.equal(state.ledgers.filter(row => row.type === 'consume').length, 1);

  const firstRefund = await billingCore.refundModelFaceItemInTransaction(tx, 'item-1', 'refund');
  const secondRefund = await billingCore.refundModelFaceItemInTransaction(tx, 'item-1', 'refund');
  assert.equal(firstRefund.status, 'refunded');
  assert.equal(secondRefund.status, 'refunded');
  assert.equal(state.balanceFen, 500);
  assert.equal(state.ledgers.filter(row => row.type === 'refund').length, 1);
});
