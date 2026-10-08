import assert from 'node:assert/strict';
import test from 'node:test';

const core = await import('../lib/admin-recharge-core.ts');

const REQ_A = '8f14e45f-ceea-467a-9575-1e1e1e1e1e01';
const REQ_B = '8f14e45f-ceea-467a-9575-1e1e1e1e1e02';
const AMOUNT = 15000;

const tick = () => new Promise(resolve => setImmediate(resolve));

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed on the fields: (`idempotencyKey`)'), { code: 'P2002' });
}

/**
 * 模拟 PostgreSQL 语义的最小替身：
 * - 事务写入先落在草稿里，提交时才并入已提交状态；
 * - idempotencyKey 唯一：create 时对已提交行立即报 P2002，提交时再复查一次（模拟两个并发事务抢同一个键，
 *   后提交者回滚，余额增量一并丢弃）；
 * - 每一步之间让出事件循环，让并发请求真的交错。
 */
function createFakeDb(initialBalances = { u1: 0, u2: 0 }) {
  const committed = { balances: { ...initialBalances }, ledger: [], nextId: 1 };
  const findCommitted = key => committed.ledger.find(row => row.idempotencyKey === key) ?? null;

  const prisma = {
    transaction: {
      findUnique: async ({ where }) => findCommitted(where.idempotencyKey),
    },
    async $transaction(fn) {
      const draft = { deltas: {}, ledger: [] };
      const tx = {
        transaction: {
          findUnique: async ({ where }) => {
            await tick();
            return findCommitted(where.idempotencyKey)
              ?? draft.ledger.find(row => row.idempotencyKey === where.idempotencyKey)
              ?? null;
          },
          create: async ({ data }) => {
            await tick();
            if (data.idempotencyKey && findCommitted(data.idempotencyKey)) throw uniqueViolation();
            draft.ledger.push({ id: `tx-${committed.nextId++}`, ...data });
          },
        },
        user: {
          update: async ({ where, data }) => {
            await tick();
            if (!(where.id in committed.balances)) throw Object.assign(new Error('No User found'), { code: 'P2025' });
            draft.deltas[where.id] = (draft.deltas[where.id] ?? 0) + data.balanceFen.increment;
            return { balanceFen: committed.balances[where.id] + draft.deltas[where.id] };
          },
        },
      };
      const value = await fn(tx);
      await tick();
      // 提交：唯一键复查，冲突则整个事务回滚
      for (const row of draft.ledger) {
        if (row.idempotencyKey && findCommitted(row.idempotencyKey)) throw uniqueViolation();
      }
      for (const [id, delta] of Object.entries(draft.deltas)) committed.balances[id] += delta;
      committed.ledger.push(...draft.ledger);
      return value;
    },
  };
  return { prisma, committed };
}

const recharge = (prisma, overrides = {}) => core.rechargeWithIdempotency(prisma, {
  userId: 'u1',
  amountFen: AMOUNT,
  description: '管理员充值',
  requestId: REQ_A,
  ...overrides,
});

test('same requestId twice only credits once and replays the first result', async () => {
  const { prisma, committed } = createFakeDb();
  const first = await recharge(prisma);
  const second = await recharge(prisma);

  assert.deepEqual(first, { success: true, balanceAfter: AMOUNT });
  assert.deepEqual(second, { success: true, balanceAfter: AMOUNT, duplicate: true });
  assert.equal(committed.balances.u1, AMOUNT);
  assert.equal(committed.ledger.length, 1);
  assert.equal(committed.ledger[0].idempotencyKey, `admin-recharge:${REQ_A}`);
  assert.equal(committed.ledger[0].type, 'recharge');
});

test('replay reports the first balanceAfter even after the balance has moved on', async () => {
  const { prisma, committed } = createFakeDb();
  await recharge(prisma);
  await recharge(prisma, { requestId: REQ_B });
  const replay = await recharge(prisma);

  assert.equal(replay.duplicate, true);
  assert.equal(replay.balanceAfter, AMOUNT);
  assert.equal(committed.balances.u1, AMOUNT * 2);
});

test('concurrent submissions with one requestId credit exactly once', async () => {
  const { prisma, committed } = createFakeDb();
  const results = await Promise.all(Array.from({ length: 5 }, () => recharge(prisma)));

  assert.equal(committed.balances.u1, AMOUNT);
  assert.equal(committed.ledger.length, 1);
  assert.ok(results.every(result => result.success === true));
  assert.equal(results.filter(result => result.duplicate === true).length, 4);
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.ok(results.every(result => result.balanceAfter === AMOUNT));
});

test('different requestIds each credit once', async () => {
  const { prisma, committed } = createFakeDb();
  const [a, b] = await Promise.all([recharge(prisma), recharge(prisma, { requestId: REQ_B })]);

  assert.equal(a.success && b.success, true);
  assert.equal(a.duplicate, undefined);
  assert.equal(b.duplicate, undefined);
  assert.equal(committed.balances.u1, AMOUNT * 2);
  assert.equal(committed.ledger.length, 2);
});

test('legacy request without requestId keeps the old non-idempotent behavior', async () => {
  const { prisma, committed } = createFakeDb();
  await recharge(prisma, { requestId: undefined });
  await recharge(prisma, { requestId: undefined });

  assert.equal(committed.balances.u1, AMOUNT * 2);
  assert.equal(committed.ledger.length, 2);
  assert.ok(committed.ledger.every(row => !('idempotencyKey' in row)));
});

test('reusing a requestId for another user or amount is a conflict, not a silent success', async () => {
  const { prisma, committed } = createFakeDb();
  await recharge(prisma);
  const otherUser = await recharge(prisma, { userId: 'u2' });
  const otherAmount = await recharge(prisma, { amountFen: AMOUNT + 7500 });

  for (const result of [otherUser, otherAmount]) {
    assert.equal(result.success, false);
    assert.equal(result.conflict, true);
  }
  assert.equal(committed.balances.u1, AMOUNT);
  assert.equal(committed.balances.u2, 0);
});

test('unknown user fails without writing a ledger row', async () => {
  const { prisma, committed } = createFakeDb();
  const result = await recharge(prisma, { userId: 'ghost' });

  assert.equal(result.success, false);
  assert.equal(committed.ledger.length, 0);
});

test('parseRechargeRequestId accepts UUIDs (normalized to lowercase) and rejects everything else', () => {
  assert.equal(core.parseRechargeRequestId(REQ_A.toUpperCase()), REQ_A);
  assert.equal(core.parseRechargeRequestId(`  ${REQ_A}  `), REQ_A);
  for (const bad of ['', 'abc', `${REQ_A}x`, `admin-recharge:${REQ_A}`, '8f14e45f-ceea-467a-9575', 123, null, undefined, {}, [REQ_A]]) {
    assert.equal(core.parseRechargeRequestId(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('request body: illegal requestId is a 400, missing requestId is allowed as legacy', () => {
  const base = { userId: 'u1', amountFen: AMOUNT };

  const bad = core.parseAdminRechargeBody({ ...base, requestId: 'not-a-uuid' });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  for (const requestId of [123, {}, 'x'.repeat(200)]) {
    assert.equal(core.parseAdminRechargeBody({ ...base, requestId }).ok, false);
  }

  const good = core.parseAdminRechargeBody({ ...base, requestId: REQ_A.toUpperCase(), description: '  备注  ' });
  assert.equal(good.ok, true);
  assert.equal(good.legacy, false);
  assert.deepEqual(good.input, { userId: 'u1', amountFen: AMOUNT, description: '备注', requestId: REQ_A });

  const legacy = core.parseAdminRechargeBody(base);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.input.requestId, undefined);
  assert.equal(legacy.input.description, '管理员充值 ¥150.00');
});

test('request body: amount and user rules are unchanged (>= 150 yuan, multiples of 75 yuan)', () => {
  for (const amountFen of [0, 7500, 14999, 15001, 22501, 15000.5, '15000', null, undefined, -15000]) {
    assert.equal(core.parseAdminRechargeBody({ userId: 'u1', amountFen }).ok, false, `amount ${String(amountFen)}`);
  }
  for (const amountFen of [15000, 22500, 30000]) {
    assert.equal(core.parseAdminRechargeBody({ userId: 'u1', amountFen }).ok, true, `amount ${amountFen}`);
  }
  for (const userId of ['', undefined, 5, null]) {
    assert.equal(core.parseAdminRechargeBody({ userId, amountFen: AMOUNT }).ok, false);
  }
  assert.equal(core.parseAdminRechargeBody(null).ok, false);
  assert.equal(core.parseAdminRechargeBody('x').ok, false);
});
