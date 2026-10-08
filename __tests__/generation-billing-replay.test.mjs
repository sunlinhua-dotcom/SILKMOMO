import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const core = await import('../lib/generation-billing-core.ts');
const idem = await import('../lib/generation-idempotency.ts');
const reconcile = await import('../lib/billing-reconcile.ts');
const guard = await import('../lib/generation-concurrency.ts');

const MIN = 60_000;

// ── 有状态内存账本：覆盖 deduct / refund / fulfilled / pending / 清扫 ──
function createWorld() {
  const world = { balanceFen: 500, ledger: [], pending: new Map(), nextId: 1 };
  const tx = {
    transaction: {
      findUnique: async ({ where }) => world.ledger.find(r => r.idempotencyKey === where.idempotencyKey) || null,
      create: async ({ data }) => {
        const row = { id: `tx-${world.nextId++}`, createdAt: new Date(), ...data };
        world.ledger.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of world.ledger) {
          if (r.id === where.id && r.userId === where.userId && r.type === where.type && r.idempotencyKey === where.idempotencyKey) {
            Object.assign(r, data); count++;
          }
        }
        return { count };
      },
    },
    user: {
      updateMany: async ({ where, data }) => {
        if (world.balanceFen < where.balanceFen.gte) return { count: 0 };
        world.balanceFen -= data.balanceFen.decrement;
        return { count: 1 };
      },
      findUnique: async () => ({ id: 'u1' }),
      findUniqueOrThrow: async () => ({ balanceFen: world.balanceFen }),
      update: async ({ data }) => { world.balanceFen += data.balanceFen.increment; return { balanceFen: world.balanceFen }; },
    },
  };
  return { world, tx };
}

const KEY = 'ckuser1234:7:2:run-abcdefgh';

/** 模拟路由对一次请求的处理：deduct → 幂等命中走 resolve（永不生成）→ 否则生成并交付。返回 generated 次数。 */
async function simulateRequest({ world, tx }, { key = KEY, upstream, deliver = 'store', clientClosed = false }) {
  const deduction = await core.deductGenerationBalanceInTransaction(tx, {
    userId: 'u1', costFen: 120, description: 't', projectId: 7, apiModel: 'm', idempotencyKey: key, awaitFulfillment: true,
  });
  if (deduction.idempotent) {
    const resolution = await idem.resolveIdempotentGeneration({
      findPending: async () => world.pending.get(key) ?? null,
      fulfilledAt: deduction.fulfilledAt, createdAt: deduction.createdAt, wait: async () => {}, attempts: 2,
    });
    return { generated: false, resolution: resolution.action };
  }
  upstream.calls++;
  let stored = false;
  let pushed = false;
  if (deliver === 'store') { world.pending.set(key, { id: 'p1', width: 1, height: 1 }); stored = true; }
  pushed = !clientClosed;
  if (stored || pushed) {
    const row = world.ledger.find(r => r.id === deduction.consumeTransactionId);
    row.fulfilledAt = new Date(); // markGenerationFulfilled
    return { generated: true, resolution: 'delivered' };
  }
  await core.refundGenerationBalanceInTransaction(tx, {
    userId: 'u1', amountFen: 120, description: 'refund', projectId: 7, idempotencyKey: key, consumeTransactionId: deduction.consumeTransactionId,
  });
  return { generated: true, resolution: 'refunded' };
}

test('DELETE pending then replaying the same runId neither generates nor charges again', async () => {
  const w = createWorld();
  const upstream = { calls: 0 };
  assert.equal((await simulateRequest(w, { upstream })).resolution, 'delivered');
  assert.equal(w.world.balanceFen, 380);

  w.world.pending.clear(); // 用户 DELETE 自己的 pending
  for (let i = 0; i < 3; i++) {
    const replay = await simulateRequest(w, { upstream });
    assert.equal(replay.generated, false);
    assert.equal(replay.resolution, 'already-delivered');
  }
  assert.equal(upstream.calls, 1, '上游只被调用一次');
  assert.equal(w.world.balanceFen, 380, '重放不再扣费');
  assert.equal(w.world.ledger.filter(r => r.type === 'consume').length, 1);
});

test('replay while pending still exists redelivers the same image', async () => {
  const w = createWorld();
  const upstream = { calls: 0 };
  await simulateRequest(w, { upstream });
  const replay = await simulateRequest(w, { upstream });
  assert.equal(replay.resolution, 'redeliver');
  assert.equal(upstream.calls, 1);
});

test('unfulfilled consume inside the window is in-flight; beyond the window it is an orphan; neither generates', async () => {
  const now = Date.now();
  const base = { findPending: async () => null, wait: async () => {}, attempts: 2, now: () => now };
  assert.equal((await idem.resolveIdempotentGeneration({ ...base, fulfilledAt: null, createdAt: new Date(now - 10 * MIN) })).action, 'in-flight');
  const justPastWindow = new Date(now - idem.GENERATION_IN_FLIGHT_WINDOW_MS - 1000);
  assert.equal((await idem.resolveIdempotentGeneration({ ...base, fulfilledAt: null, createdAt: justPastWindow })).action, 'orphan');
  assert.ok(idem.GENERATION_ORPHAN_AGE_MS > idem.GENERATION_IN_FLIGHT_WINDOW_MS, '清扫门槛必须大于在途窗口');
});

test('client disconnect after pending is stored keeps the charge and marks fulfilled', async () => {
  const w = createWorld();
  const upstream = { calls: 0 };
  const out = await simulateRequest(w, { upstream, deliver: 'store', clientClosed: true });
  assert.equal(out.resolution, 'delivered');
  assert.equal(w.world.balanceFen, 380, '不退款');
  assert.ok(w.world.ledger[0].fulfilledAt instanceof Date);
  assert.equal(w.world.ledger.filter(r => r.type === 'refund').length, 0);
});

test('only "pending not stored AND push failed" refunds', async () => {
  const w = createWorld();
  const out = await simulateRequest(w, { upstream: { calls: 0 }, deliver: 'none', clientClosed: true });
  assert.equal(out.resolution, 'refunded');
  assert.equal(w.world.balanceFen, 500);
});

test('route wiring: all three branches settle through settleDelivery and none refunds on bare clientClosed', () => {
  const route = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  assert.equal((route.match(/await settleDelivery\(/g) || []).length, 3);
  assert.doesNotMatch(route, /客户端断开退款/);
  assert.doesNotMatch(route, /redeliverIdempotentResult/);
  assert.doesNotMatch(route, /action === 'generate'/);
  // 预检：带 runId 也走 preflightBalanceCheck，不再 `runId ? null`
  assert.equal((route.match(/await preflightBalanceCheck\(/g) || []).length, 3);
  assert.doesNotMatch(route, /const preflightBalance = runId \? null/);
  // 校验 taskId、请求体上限、并发名额释放
  assert.match(route, /Number\.isInteger\(taskId\) \|\| taskId <= 0/);
  assert.match(route, /readJsonBodyWithLimit\(req, maxBodyBytes\)/);
  assert.match(route, /status: 413/);
  assert.match(route, /slot\.release\(\)/);
  assert.equal((route.match(/awaitFulfillment: true/g) || []).length, 3);
  // mirror 常量与路由 maxDuration 一致
  assert.match(route, new RegExp(`export const maxDuration = ${idem.GENERATION_MAX_DURATION_SECONDS};`));
});

test('zero-balance user with a runId is rejected by preflight before any upstream call (wiring)', () => {
  const route = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  // 产品图 / 单张场景：预检在服装分析之前；组图在服装分析之前也已预检
  const productPreflight = route.indexOf('const preflightBalance = await preflightBalanceCheck(');
  const productAnalysis = route.indexOf("analyzeProductImage(productImages[0].data", productPreflight);
  assert.ok(productPreflight > 0 && productAnalysis > productPreflight);
  // 豁免条件只有「首镜幂等键已有 consume」
  assert.match(route, /if \(firstShotKey && await hasGenerationConsume\(userId, firstShotKey\)\) return null;/);
});

// ── 清扫 ──
function row(over) {
  return {
    id: 'tx', userId: 'u1', type: 'consume', amountFen: -120, projectId: 7,
    idempotencyKey: KEY, fulfilledAt: null, createdAt: new Date(Date.now() - 30 * MIN), ...over,
  };
}

test('reconcile refunds only new-format, unfulfilled, past-window generation consumes', async () => {
  const now = Date.now();
  const rows = [
    row({ id: 'orphan' }),
    row({ id: 'backfilled', idempotencyKey: 'ckuser1234:7:3:run-abcdefgh', fulfilledAt: new Date(now - 60 * MIN) }), // 迁移回填的历史流水
    row({ id: 'recent', idempotencyKey: 'ckuser1234:7:4:run-abcdefgh', createdAt: new Date(now - 5 * MIN) }),
    row({ id: 'modelface', idempotencyKey: 'ckmodelface999:charge' }),
    row({ id: 'nokey', idempotencyKey: null }),
    row({ id: 'refund', type: 'refund', amountFen: 120, idempotencyKey: 'ckuser1234:7:5:run-abcdefgh' }),
    row({ id: 'badrun', idempotencyKey: 'ckuser1234:7:6:short' }),
  ];
  const refunded = [];
  const summary = await reconcile.reconcileGenerationBilling({
    now: () => now,
    listCandidates: async () => rows, // 故意给全集，验证纯逻辑二次过滤
    hasPending: async () => false,
    hasSuccessRecord: async () => false,
    markFulfilled: async () => true,
    refund: async r => { refunded.push(r.id); return { success: true }; },
    sweepExpiredPending: async () => 4,
  });
  assert.deepEqual(refunded, ['orphan']);
  assert.equal(summary.refunded, 1);
  assert.equal(summary.expiredPending, 4);
});

test('reconcile marks fulfilled instead of refunding when the pending image still exists', async () => {
  const marks = [];
  const refunds = [];
  const summary = await reconcile.reconcileGenerationBilling({
    now: () => Date.now(),
    listCandidates: async () => [row({ id: 'has-pending' })],
    hasPending: async () => true,
    hasSuccessRecord: async () => false,
    markFulfilled: async id => { marks.push(id); return true; },
    refund: async r => { refunds.push(r.id); return { success: true }; },
  });
  assert.deepEqual(marks, ['has-pending']);
  assert.deepEqual(refunds, []);
  assert.equal(summary.markedFulfilled, 1);
});

test('a reconcile refund is idempotent end-to-end: second sweep refunds nothing', async () => {
  const w = createWorld();
  const d = await core.deductGenerationBalanceInTransaction(w.tx, {
    userId: 'u1', costFen: 120, description: 't', projectId: 7, apiModel: 'm', idempotencyKey: KEY, awaitFulfillment: true,
  });
  w.world.ledger[0].createdAt = new Date(Date.now() - 30 * MIN);
  const deps = {
    now: () => Date.now(),
    listCandidates: async () => w.world.ledger.filter(r => r.type === 'consume' && !r.fulfilledAt && r.idempotencyKey),
    hasPending: async () => false,
    hasSuccessRecord: async () => false,
    markFulfilled: async () => true,
    refund: async r => {
      await core.refundGenerationBalanceInTransaction(w.tx, {
        userId: r.userId, amountFen: -r.amountFen, description: 'x', projectId: 7, idempotencyKey: r.idempotencyKey, consumeTransactionId: r.id,
      });
      return { success: true };
    },
  };
  assert.equal(w.world.balanceFen, 380);
  await reconcile.reconcileGenerationBilling(deps);
  assert.equal(w.world.balanceFen, 500);
  await reconcile.reconcileGenerationBilling(deps); // 键已被认领置空，不再命中
  assert.equal(w.world.balanceFen, 500);
  assert.equal(w.world.ledger.filter(r => r.type === 'refund').length, 1);
  assert.ok(d.consumeTransactionId);
});

test('migration backfills historical consume rows and the sweep only trusts generation key format', () => {
  const sql = fs.readFileSync('prisma/migrations/20261008000000_billing_fulfillment_and_indexes/migration.sql', 'utf8');
  assert.match(sql, /UPDATE "Transaction" SET "fulfilledAt" = "createdAt" WHERE "type" = 'consume'/);
  assert.ok(sql.indexOf('ADD COLUMN "fulfilledAt"') < sql.indexOf('UPDATE "Transaction"'));
  assert.ok(idem.isGenerationIdempotencyKey(KEY));
  assert.equal(idem.isGenerationIdempotencyKey('ckmodelface999:charge'), false);
  assert.equal(idem.isGenerationIdempotencyKey(null), false);
  assert.equal(idem.generationIdempotencyKey('u', 1, 2, 'run-12345678'), 'u:1:2:run-12345678');
});

test('refund retries with exponential backoff and reports exhaustion', async () => {
  const sleeps = [];
  let calls = 0;
  const flaky = await core.retryWithBackoff(async () => { if (++calls < 3) throw new Error('boom'); return 'ok'; }, { sleep: async ms => { sleeps.push(ms); } });
  assert.deepEqual({ ok: flaky.ok, attempts: flaky.attempts, sleeps }, { ok: true, attempts: 3, sleeps: [300, 600] });

  const dead = [];
  const failed = await core.retryWithBackoff(async () => { throw new Error('down'); }, { sleep: async ms => { dead.push(ms); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.attempts, 4); // 首次 + 重试 3 次
  assert.deepEqual(dead, [300, 600, 1200]);
});

// ── 并发上限 / 请求体 ──
test('per-user concurrency limit rejects over the cap and releases exactly once', () => {
  const limiter = guard.createGenerationConcurrencyLimiter(() => 2);
  const a = limiter.tryAcquire('u1');
  const b = limiter.tryAcquire('u1');
  assert.ok(a && b);
  assert.equal(limiter.tryAcquire('u1'), null);
  assert.equal(limiter.isFull('u1'), true);
  assert.ok(limiter.tryAcquire('u2'), '别的用户不受影响');
  a.release();
  a.release(); // 重复释放无副作用
  assert.equal(limiter.active('u1'), 1);
  assert.ok(limiter.tryAcquire('u1'));
  assert.equal(limiter.active('u1'), 2);
});

test('concurrency env parsing: default 3, valid override, garbage falls back', () => {
  assert.equal(guard.getMaxConcurrentGenerationsPerUser({}), 3);
  assert.equal(guard.getMaxConcurrentGenerationsPerUser({ GENERATION_MAX_CONCURRENT_PER_USER: '5' }), 5);
  assert.equal(guard.getMaxConcurrentGenerationsPerUser({ GENERATION_MAX_CONCURRENT_PER_USER: '0' }), 3);
  assert.equal(guard.getMaxConcurrentGenerationsPerUser({ GENERATION_MAX_CONCURRENT_PER_USER: 'abc' }), 3);
});

test('route returns 429 before the stream and releases the slot in finally', () => {
  const route = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  assert.match(route, /status: 429/);
  assert.match(route, /if \(limiter\.isFull\(auth\.userId\)\)/);
  assert.match(route, /const slot = limiter\.tryAcquire\(auth\.userId\);\n\s+if \(!slot\) return busyResponse\(\);/);
  const finallyBlock = route.slice(route.lastIndexOf('} finally {'));
  assert.match(finallyBlock, /slot\.release\(\)/);
});

test('body limit: content-length over cap is rejected without reading; streamed overflow is rejected; max legit lookbook fits', async () => {
  const mk = (text, headers = {}) => new Request('http://x/', { method: 'POST', body: text, headers });
  await assert.rejects(
    guard.readJsonBodyWithLimit({ headers: { get: () => '999999999' }, body: new ReadableStream() }, 1000),
    guard.RequestBodyTooLargeError,
  );
  const big = JSON.stringify({ a: 'x'.repeat(5000) });
  const req = mk(big);
  const stripped = { headers: { get: () => null }, body: req.body }; // 无 content-length（chunked）
  await assert.rejects(guard.readJsonBodyWithLimit(stripped, 1000), guard.RequestBodyTooLargeError);
  assert.deepEqual(await guard.readJsonBodyWithLimit(mk('{"ok":1}'), 1000), { ok: 1 });
  await assert.rejects(guard.readJsonBodyWithLimit(mk('not json'), 1000), SyntaxError);
  // 20 张场景图 + 8 产品 + 6 + 6 + 6 配件，每张 800KiB base64 ≈ 1.07MiB，再加两张 3MiB 锚点 + 余量
  const worstCase = 46 * Math.ceil(800 * 1024 * 4 / 3) + 2 * 3 * 1024 * 1024 + 100 * 1024;
  assert.ok(worstCase < guard.DEFAULT_MAX_BODY_BYTES, `${worstCase} 应小于 ${guard.DEFAULT_MAX_BODY_BYTES}`);
  assert.ok(guard.DEFAULT_MAX_BODY_BYTES < 100 * 1024 * 1024, '上限不能松到几百 MB');
});

test('reconcile: a successful GenerationRecord means delivered -> mark fulfilled, never refund; failure-only records still refund', async () => {
  const records = [
    // userId, taskId, shotIndex, success, createdAt 偏移（相对 consume，分钟）
    { userId: 'u1', taskId: 7, shotIndex: 2, success: true, offsetMin: 3 },
    { userId: 'u1', taskId: 7, shotIndex: 3, success: false, offsetMin: 3 },
    { userId: 'u1', taskId: 7, shotIndex: 4, success: true, offsetMin: 40 }, // 超出在途窗口，不算
  ];
  const mkDeps = (marks, refunds) => ({
    now: () => Date.now(),
    listCandidates: async () => [
      row({ id: 'ok', idempotencyKey: 'u1:7:2:run-abcdefgh' }),
      row({ id: 'failed-only', idempotencyKey: 'u1:7:3:run-abcdefgh' }),
      row({ id: 'late-record', idempotencyKey: 'u1:7:4:run-abcdefgh' }),
    ],
    hasPending: async () => false,
    hasSuccessRecord: async r => {
      const k = reconcile.parseGenerationKey(r.idempotencyKey);
      return records.some(x => x.userId === r.userId && x.taskId === k.taskId && x.shotIndex === k.shotIndex
        && x.success && x.offsetMin * MIN <= idem.GENERATION_IN_FLIGHT_WINDOW_MS);
    },
    markFulfilled: async id => { marks.push(id); return true; },
    refund: async r => { refunds.push(r.id); return { success: true }; },
  });
  const marks = [];
  const refunds = [];
  const summary = await reconcile.reconcileGenerationBilling(mkDeps(marks, refunds));
  assert.deepEqual(marks, ['ok']);
  assert.deepEqual(refunds, ['failed-only', 'late-record']);
  assert.equal(summary.markedFulfilled, 1);
  assert.deepEqual(reconcile.parseGenerationKey('u1:7:0:run-abcdefgh'), { taskId: 7, shotIndex: 0 });
  assert.equal(reconcile.parseGenerationKey('x:charge'), null);
});

test('同 runId 整次重放时不再为服装分析调用上游（部分重试仍分析）', async () => {
  const fs = await import('node:fs');
  const route = fs.readFileSync(new URL('../app/api/generate/stream/route.ts', import.meta.url), 'utf8');
  // 产品图：所有镜次的幂等键都已 consume 才跳过分析
  assert.match(route, /async function isFullGenerationReplay\(/);
  assert.match(route, /const productFullReplay = runId\s*\?\s*await isFullGenerationReplay\(/);
  assert.match(route, /if \(!productFullReplay\) \{\s*push\('status', \{ phase: 'analyzing'/);
  // 单张场景图：首镜（唯一一镜）已 consume（preflight 返回 null）即整次重放
  assert.match(route, /if \(preflightBalance !== null\) \{\s*push\('status', \{ phase: 'analyzing'/);
});
