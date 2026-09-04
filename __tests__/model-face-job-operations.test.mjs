import assert from 'node:assert/strict';
import test from 'node:test';

const operations = await import('../lib/model-face-job-operations.ts').catch(() => ({}));

function createRefundSweepPrisma() {
  const state = {
    job: { id: 'job-1', userId: 'u1', status: 'failed' },
    item: {
      id: 'item-1', jobId: 'job-1', specIndex: 0, status: 'running',
      billingStatus: 'charged', error: 'P2028 transaction expired',
    },
  };
  const matchesWhere = where => {
    if (where.job?.userId && where.job.userId !== state.job.userId) return false;
    return where.OR.some(condition => {
      if (condition.billingStatus !== state.item.billingStatus) return false;
      const allowedStatuses = condition.job?.status?.in;
      return !allowedStatuses || allowedStatuses.includes(state.job.status);
    });
  };
  const prisma = {
    modelFaceGenerationItem: {
      findMany: async ({ where }) => matchesWhere(where) ? [{ ...state.item }] : [],
      updateMany: async ({ where, data }) => {
        const allowedBilling = typeof where.billingStatus === 'string'
          ? where.billingStatus === state.item.billingStatus
          : where.billingStatus.in.includes(state.item.billingStatus);
        if (where.id !== state.item.id || !allowedBilling) return { count: 0 };
        Object.assign(state.item, data);
        return { count: 1 };
      },
    },
  };
  return { state, prisma };
}

test('charged item left by failed refund persistence is recovered by the terminal-job sweep', async () => {
  assert.equal(typeof operations.retryPendingModelFaceRefundsWithDeps, 'function');
  const { state, prisma } = createRefundSweepPrisma();
  const synced = [];

  const count = await operations.retryPendingModelFaceRefundsWithDeps('u1', {
    prisma,
    refund: async () => {
      state.item.billingStatus = 'refunded';
      return { success: true, status: 'refunded' };
    },
    syncJobCounts: async jobId => { synced.push(jobId); },
  });

  assert.equal(count, 1);
  assert.equal(state.item.status, 'failed');
  assert.equal(state.item.billingStatus, 'refunded');
  assert.match(state.item.error, /已退款/);
  assert.deepEqual(synced, ['job-1']);
});

test('old worker cannot reset a running item after a new runner takes over the lease', async () => {
  assert.equal(typeof operations.resetBlockedModelFaceItem, 'function');
  const state = {
    job: { runnerId: 'new-runner' },
    item: { id: 'item-1', status: 'running', error: null },
  };
  const prisma = {
    modelFaceGenerationItem: {
      updateMany: async ({ where, data }) => {
        if (where.id !== state.item.id || where.status !== state.item.status) return { count: 0 };
        if (where.job?.runnerId !== state.job.runnerId) return { count: 0 };
        Object.assign(state.item, data);
        return { count: 1 };
      },
    },
  };

  const stale = await operations.resetBlockedModelFaceItem(prisma, 'item-1', 'old-runner', 'blocked');
  assert.equal(stale.count, 0);
  assert.equal(state.item.status, 'running');

  const owner = await operations.resetBlockedModelFaceItem(prisma, 'item-1', 'new-runner', 'blocked');
  assert.equal(owner.count, 1);
  assert.equal(state.item.status, 'pending');
});

test('mark-attempt transaction records a real-attempt slot once and refuses a duplicate', async () => {
  assert.equal(typeof operations.markModelFaceAttemptWithDeps, 'function');
  const state = { attemptedAt: null, used: 199 };
  const tx = {
    modelFaceGenerationItem: {
      findUniqueOrThrow: async () => ({ attemptedAt: state.attemptedAt }),
      count: async () => state.used,
      updateMany: async ({ where, data }) => {
        if (where.attemptedAt !== null || state.attemptedAt !== null) return { count: 0 };
        state.attemptedAt = data.attemptedAt;
        state.used += 1;
        return { count: 1 };
      },
    },
  };
  const prisma = { $transaction: async callback => callback(tx) };
  const deps = {
    prisma,
    startOfDay: () => new Date('2026-09-03T16:00:00.000Z'),
    hasCapacity: used => used < 200,
    limit: 200,
  };

  assert.deepEqual(
    await operations.markModelFaceAttemptWithDeps('item-1', 'u1', deps),
    { success: true },
  );
  assert.deepEqual(
    await operations.markModelFaceAttemptWithDeps('item-1', 'u1', deps),
    { success: false, error: '该图片已发起过上游生成' },
  );
  assert.equal(state.used, 200);
});

test('only Prisma P2002 is classified as the active-job uniqueness conflict', () => {
  assert.equal(typeof operations.isPrismaUniqueConstraintError, 'function');
  assert.equal(operations.isPrismaUniqueConstraintError({ code: 'P2002', message: 'opaque' }), true);
  assert.equal(operations.isPrismaUniqueConstraintError(new Error('Unique constraint failed')), false);
  assert.equal(operations.isPrismaUniqueConstraintError({ code: 'P2028' }), false);
});
