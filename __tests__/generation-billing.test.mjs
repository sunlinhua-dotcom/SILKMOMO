import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const billing = await import('../lib/generation-billing-core.ts').catch(() => ({}));

function createStatefulTransaction() {
  const state = { balanceFen: 500, ledger: [] };
  const tx = {
    transaction: {
      findUnique: async ({ where }) => state.ledger.find(row => row.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        assert.equal(state.ledger.some(row => row.idempotencyKey && row.idempotencyKey === data.idempotencyKey), false);
        state.ledger.push(data);
        return data;
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

  assert.deepEqual(first, { balanceAfter: 380, idempotent: false });
  assert.deepEqual(duplicate, { balanceAfter: 380, idempotent: true });
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

test('route keys every shot by user task shot and run, then reuses only matching pending delivery', () => {
  const route = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const page = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');
  assert.match(route, /`\$\{userId\}:\$\{taskId\}:\$\{shotIndex\}:\$\{runId\}`/);
  assert.match(route, /findPendingImageByIdempotencyKey\(userId, idempotencyKey\)/);
  assert.match(route, /该镜次已付费，请刷新取回/);
  assert.match(page, /const runId = opts\?\.runId \|\| crypto\.randomUUID\(\)/);
  assert.match(page, /runId,\s*\n\s*\}\),/);
  assert.match(page, /pendingAutoRetryRunIdRef\.current = runId/);
});
