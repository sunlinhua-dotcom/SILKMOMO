import assert from 'node:assert/strict';
import test from 'node:test';

const billing = await import('../lib/generation-billing-core.ts').catch(() => ({}));
const idempotency = await import('../lib/generation-idempotency.ts').catch(() => ({}));

function createStatefulTransaction() {
  const state = { balanceFen: 500, ledger: [], nextId: 1 };
  const tx = {
    transaction: {
      findUnique: async ({ where }) => state.ledger.find(row => row.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        assert.equal(state.ledger.some(row => row.idempotencyKey && row.idempotencyKey === data.idempotencyKey), false);
        const row = { id: `tx-${state.nextId++}`, ...data };
        state.ledger.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.ledger) {
          if ((!where.id || row.id === where.id)
            && row.userId === where.userId
            && row.type === where.type
            && row.idempotencyKey === where.idempotencyKey) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      },
    },
    user: {
      updateMany: async ({ where, data }) => {
        if (state.balanceFen < where.balanceFen.gte) return { count: 0 };
        state.balanceFen -= data.balanceFen.decrement;
        return { count: 1 };
      },
      findUnique: async () => ({ id: 'u1' }),
      findUniqueOrThrow: async () => ({ balanceFen: state.balanceFen }),
      update: async ({ data }) => {
        state.balanceFen += data.balanceFen.increment;
        return { balanceFen: state.balanceFen };
      },
    },
  };
  return { state, tx };
}

test('same generation idempotency key debits once and reports a reusable delivery', async () => {
  assert.equal(typeof billing.deductGenerationBalanceInTransaction, 'function');
  const { state, tx } = createStatefulTransaction();
  const input = {
    userId: 'u1', costFen: 120, description: '镜次 #2', projectId: 7,
    apiModel: 'gpt-image-2-all', idempotencyKey: 'u1:7:2:run-12345',
  };

  const first = await billing.deductGenerationBalanceInTransaction(tx, input);
  const duplicate = await billing.deductGenerationBalanceInTransaction(tx, input);

  assert.deepEqual(first, { balanceAfter: 380, idempotent: false, consumeTransactionId: 'tx-1' });
  // 幂等命中额外带回既有 consume 的 fulfilledAt / createdAt，供路由判断已履约 / 在途 / 孤儿
  assert.equal(duplicate.balanceAfter, 380);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.consumeTransactionId, 'tx-1');
  assert.ok(duplicate.fulfilledAt instanceof Date, '没有 awaitFulfillment 的扣费创建即履约');
  assert.equal(duplicate.createdAt, null);
  assert.equal(state.balanceFen, 380);
  assert.equal(state.ledger.length, 1);
});

test('legacy generation without an idempotency key retains per-call charging', async () => {
  const { state, tx } = createStatefulTransaction();
  const input = {
    userId: 'u1', costFen: 120, description: '镜次 #2', projectId: 7,
    apiModel: 'gpt-image-2-all',
  };
  await billing.deductGenerationBalanceInTransaction(tx, input);
  await billing.deductGenerationBalanceInTransaction(tx, input);
  assert.equal(state.balanceFen, 260);
  assert.equal(state.ledger.length, 2);
});

test('a refunded shot releases its key so the same run can debit and generate again', async () => {
  assert.equal(typeof billing.refundGenerationBalanceInTransaction, 'function');
  const { state, tx } = createStatefulTransaction();
  const input = {
    userId: 'u1', costFen: 120, description: '镜次 #2', projectId: 7,
    apiModel: 'gpt-image-2-all', idempotencyKey: 'u1:7:2:run-12345',
  };

  const first = await billing.deductGenerationBalanceInTransaction(tx, input);
  await billing.refundGenerationBalanceInTransaction(tx, {
    userId: 'u1', amountFen: 120, description: '镜次 #2 失败退款', projectId: 7,
    idempotencyKey: input.idempotencyKey,
    consumeTransactionId: first.consumeTransactionId,
  });
  const retry = await billing.deductGenerationBalanceInTransaction(tx, input);

  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, false);
  assert.equal(state.balanceFen, 380);
  assert.equal(state.ledger.filter(row => row.type === 'consume').length, 2);
  assert.equal(state.ledger.filter(row => row.type === 'refund').length, 1);
});

test('a late duplicate refund cannot refund a newer debit that reused the same run key', async () => {
  const { state, tx } = createStatefulTransaction();
  const input = {
    userId: 'u1', costFen: 120, description: '镜次 #2', projectId: 7,
    apiModel: 'gpt-image-2-all', idempotencyKey: 'u1:7:2:run-12345',
  };
  const first = await billing.deductGenerationBalanceInTransaction(tx, input);
  const refund = {
    userId: 'u1', amountFen: 120, description: '镜次 #2 失败退款', projectId: 7,
    idempotencyKey: input.idempotencyKey,
    consumeTransactionId: first.consumeTransactionId,
  };
  await billing.refundGenerationBalanceInTransaction(tx, refund);
  const second = await billing.deductGenerationBalanceInTransaction(tx, input);
  await billing.refundGenerationBalanceInTransaction(tx, refund);
  const duplicateSecond = await billing.deductGenerationBalanceInTransaction(tx, input);

  assert.equal(state.balanceFen, 380);
  assert.equal(second.idempotent, false);
  assert.equal(duplicateSecond.idempotent, true);
  assert.equal(duplicateSecond.consumeTransactionId, second.consumeTransactionId);
  assert.equal(state.ledger.filter(row => row.type === 'refund').length, 1);
});

test('an idempotency race waits for the winning pending delivery', async () => {
  assert.equal(typeof idempotency.resolveIdempotentGeneration, 'function');
  let reads = 0;
  const result = await idempotency.resolveIdempotentGeneration({
    findPending: async () => (++reads === 3 ? { id: 'pending-winner', width: 100, height: 200 } : null),
    wait: async () => {},
    attempts: 3,
  });
  assert.deepEqual(result, {
    action: 'redeliver',
    pending: { id: 'pending-winner', width: 100, height: 200 },
  });
  assert.equal(reads, 3);
});

test('an idempotent debit without pending never falls through to generation (P0 free-replay fix)', async () => {
  const now = Date.now();
  const none = async () => null;
  const wait = async () => {};
  // 已履约（pending 被取走 / 被用户 DELETE）→ 不再生成
  assert.deepEqual(await idempotency.resolveIdempotentGeneration({
    findPending: none, fulfilledAt: new Date(now - 1000), createdAt: new Date(now - 5000), wait, attempts: 2,
  }), { action: 'already-delivered' });
  // 未履约、在途窗口内 → 提示仍在生成，不生成
  assert.deepEqual(await idempotency.resolveIdempotentGeneration({
    findPending: none, fulfilledAt: null, createdAt: new Date(now - 5000), wait, attempts: 2,
  }), { action: 'in-flight' });
  // 未履约、超窗口 → 孤儿，不生成
  assert.deepEqual(await idempotency.resolveIdempotentGeneration({
    findPending: none, fulfilledAt: null, createdAt: new Date(now - 3600_000), wait, attempts: 2,
  }), { action: 'orphan' });
});

test('insufficient deduction errors preserve the current balance wording', () => {
  assert.equal(
    billing.formatGenerationDeductionError('余额不足', 345, true),
    '余额不足（当前 ¥3.45），已停止生成',
  );
  assert.equal(
    billing.formatGenerationDeductionError('数据库不可用', 0, false),
    '扣费失败: 数据库不可用',
  );
  // Prisma 原文等非白名单错误不透传
  assert.equal(billing.toSafeBillingError(new Error('Invalid `prisma.user.updateMany()` invocation')), billing.GENERIC_BILLING_ERROR);
  assert.equal(billing.toSafeBillingError(new Error('余额不足')), '余额不足');
});
