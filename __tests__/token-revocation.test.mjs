import assert from 'node:assert/strict';
import test from 'node:test';

const core = await import('../lib/token-revocation-core.ts');

/** 内存假存储：行为对齐 PG 实现（revoke 幂等；isRevoked 是主键查询），并统计调用次数 */
function createFakeStore() {
  const rows = new Map(); // jti -> { userId, expiresAt }
  const calls = { isRevoked: 0, revoke: 0, purgeBatch: 0 };
  const store = {
    failing: false,
    rows,
    calls,
    async isRevoked(jti) {
      calls.isRevoked++;
      if (store.failing) throw new Error('db down');
      return rows.has(jti);
    },
    async revoke(jti, userId, expiresAt) {
      calls.revoke++;
      if (store.failing) throw new Error('db down');
      if (!rows.has(jti)) rows.set(jti, { userId, expiresAt }); // ON CONFLICT DO NOTHING
    },
    async purgeBatch(before, limit) {
      calls.purgeBatch++;
      let n = 0;
      for (const [jti, row] of rows) {
        if (n >= limit) break;
        if (row.expiresAt < before) {
          rows.delete(jti);
          n++;
        }
      }
      return n;
    },
  };
  return store;
}

function createClock(start = 1_000_000) {
  const clock = { t: start, now: () => clock.t };
  return clock;
}

const EXP_SEC = 2_000_000; // 远在时钟之后

test('老 token（没有 jti）一律视为未吊销，且不查库', async () => {
  const store = createFakeStore();
  const checker = core.createRevocationChecker(store);
  assert.equal(await checker.isRevoked(undefined, EXP_SEC), false);
  assert.equal(await checker.isRevoked(null, EXP_SEC), false);
  assert.equal(await checker.isRevoked('', EXP_SEC), false);
  assert.equal(store.calls.isRevoked, 0);
});

test('吊销后同一 jti 立即判定为已吊销，别的 jti 不受影响', async () => {
  const store = createFakeStore();
  const clock = createClock();
  const checker = core.createRevocationChecker(store, { now: clock.now });
  assert.equal(await checker.isRevoked('jti-a', EXP_SEC), false);
  await checker.revoke('jti-a', 'u1', EXP_SEC);
  // 本实例缓存立刻生效（不用等 30 秒）
  assert.equal(await checker.isRevoked('jti-a', EXP_SEC), true);
  assert.equal(await checker.isRevoked('jti-b', EXP_SEC), false);
  assert.ok(store.rows.has('jti-a'));
  assert.equal(store.rows.get('jti-a').userId, 'u1');
  assert.equal(store.rows.get('jti-a').expiresAt.getTime(), EXP_SEC * 1000);
});

test('多实例：另一个实例（独立缓存）最迟 30 秒后看到吊销', async () => {
  const store = createFakeStore();
  const clock = createClock();
  const a = core.createRevocationChecker(store, { now: clock.now });
  const b = core.createRevocationChecker(store, { now: clock.now });
  assert.equal(await b.isRevoked('jti-x', EXP_SEC), false); // b 缓存「未吊销」
  await a.revoke('jti-x', 'u1', EXP_SEC);
  assert.equal(await b.isRevoked('jti-x', EXP_SEC), false, '缓存期内 b 还看不到');
  clock.t += core.NOT_REVOKED_TTL_MS + 1;
  assert.equal(await b.isRevoked('jti-x', EXP_SEC), true, '缓存过期后 b 查库得到已吊销');
});

test('未吊销结果缓存 30 秒，期内不重复查库；过期后再查', async () => {
  const store = createFakeStore();
  const clock = createClock();
  const checker = core.createRevocationChecker(store, { now: clock.now });
  for (let i = 0; i < 5; i++) assert.equal(await checker.isRevoked('jti-c', EXP_SEC), false);
  assert.equal(store.calls.isRevoked, 1);
  clock.t += core.NOT_REVOKED_TTL_MS - 1;
  await checker.isRevoked('jti-c', EXP_SEC);
  assert.equal(store.calls.isRevoked, 1);
  clock.t += 2;
  await checker.isRevoked('jti-c', EXP_SEC);
  assert.equal(store.calls.isRevoked, 2);
});

test('已吊销结果缓存到令牌自然过期（不会再变回有效，也不重复查库）', async () => {
  const store = createFakeStore();
  const clock = createClock();
  const checker = core.createRevocationChecker(store, { now: clock.now });
  store.rows.set('jti-d', { userId: 'u1', expiresAt: new Date(EXP_SEC * 1000) });
  assert.equal(await checker.isRevoked('jti-d', EXP_SEC), true);
  clock.t += 10 * 60 * 1000;
  assert.equal(await checker.isRevoked('jti-d', EXP_SEC), true);
  assert.equal(store.calls.isRevoked, 1);
});

test('重复登出（重复 revoke 同一个 jti）幂等，不抛错、只留一行', async () => {
  const store = createFakeStore();
  const checker = core.createRevocationChecker(store);
  await checker.revoke('jti-e', 'u1', EXP_SEC);
  await assert.doesNotReject(() => checker.revoke('jti-e', 'u1', EXP_SEC));
  await assert.doesNotReject(() => checker.revoke('jti-e', 'u1', EXP_SEC));
  assert.equal(store.rows.size, 1);
  assert.equal(await checker.isRevoked('jti-e', EXP_SEC), true);
});

test('查库失败 fail-open：按未吊销放行、日志节流、失败结果只短暂缓存', async () => {
  const store = createFakeStore();
  const clock = createClock();
  const logs = [];
  const checker = core.createRevocationChecker(store, { now: clock.now, logError: (m) => logs.push(m) });
  store.failing = true;
  assert.equal(await checker.isRevoked('jti-f', EXP_SEC), false);
  assert.equal(await checker.isRevoked('jti-g', EXP_SEC), false);
  assert.equal(await checker.isRevoked('jti-h', EXP_SEC), false);
  assert.equal(logs.length, 1, '同一分钟内多次失败只打一次日志');
  // 失败结果缓存很短：同一个 jti 5 秒内不再撞库
  const before = store.calls.isRevoked;
  await checker.isRevoked('jti-f', EXP_SEC);
  assert.equal(store.calls.isRevoked, before);
  // 库恢复后，缓存过期（5 秒）下一次立刻回到正常判定
  store.failing = false;
  store.rows.set('jti-f', { userId: 'u1', expiresAt: new Date(EXP_SEC * 1000) });
  clock.t += core.FAIL_OPEN_TTL_MS + 1;
  assert.equal(await checker.isRevoked('jti-f', EXP_SEC), true);
  // 日志节流窗口过后再失败会再打一次
  store.failing = true;
  clock.t += 61_000;
  await checker.isRevoked('jti-z', EXP_SEC);
  assert.equal(logs.length, 2);
});

test('登出时写库失败：revoke 抛出，但本实例缓存已吊销（该实例上令牌立即失效）', async () => {
  const store = createFakeStore();
  const checker = core.createRevocationChecker(store, { logError: () => {} });
  store.failing = true;
  await assert.rejects(() => checker.revoke('jti-i', 'u1', EXP_SEC), /db down/);
  assert.equal(await checker.isRevoked('jti-i', EXP_SEC), true);
});

test('缓存条目有硬上限', async () => {
  const store = createFakeStore();
  const checker = core.createRevocationChecker(store, { maxEntries: 100 });
  for (let i = 0; i < 500; i++) await checker.isRevoked(`jti-${i}`, EXP_SEC);
  assert.ok(checker.cacheSize() <= 100, `缓存 ${checker.cacheSize()} 条超过上限`);
});

test('purgeExpiredFromStore 分批清理过期行，保留未过期行', async () => {
  const store = createFakeStore();
  const now = new Date('2026-10-08T00:00:00Z');
  for (let i = 0; i < 25; i++) store.rows.set(`old-${i}`, { userId: 'u', expiresAt: new Date(now.getTime() - 1000 - i) });
  for (let i = 0; i < 3; i++) store.rows.set(`live-${i}`, { userId: 'u', expiresAt: new Date(now.getTime() + 60_000) });
  const removed = await core.purgeExpiredFromStore(store, now, 10);
  assert.equal(removed, 25);
  assert.equal(store.rows.size, 3);
  assert.ok(store.calls.purgeBatch >= 3, '25 行、每批 10 行至少 3 批');
  assert.equal(await core.purgeExpiredFromStore(store, now, 10), 0);
});
