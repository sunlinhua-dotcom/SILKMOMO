import assert from 'node:assert/strict';
import test from 'node:test';

const rl = await import('../lib/rate-limit.ts');

/**
 * 内存假存储：固定窗口，语义对齐 lib/rate-limit-store.ts 里的 SQL
 * （窗口过期则重置为 1，否则 +1；peek 只返回未过期窗口）。可注入时钟、可切换为故障。
 */
function createFakeStore() {
  const rows = new Map(); // key -> { count, resetAt }
  const clock = { t: 1_000_000 };
  const store = {
    clock,
    rows,
    failing: false,
    async hit(key, windowMs) {
      if (store.failing) throw new Error('db down');
      const row = rows.get(key);
      if (!row || row.resetAt <= clock.t) {
        rows.set(key, { count: 1, resetAt: clock.t + windowMs });
      } else {
        row.count += 1;
      }
      const cur = rows.get(key);
      return { count: cur.count, ttlMs: cur.resetAt - clock.t };
    },
    async peek(key) {
      if (store.failing) throw new Error('db down');
      const row = rows.get(key);
      if (!row || row.resetAt <= clock.t) return null;
      return { count: row.count, ttlMs: row.resetAt - clock.t };
    },
    async reset(key) {
      if (store.failing) throw new Error('db down');
      rows.delete(key);
    },
  };
  return store;
}

function setup() {
  rl.__resetAllBuckets();
  const store = createFakeStore();
  const warns = [];
  rl.__setRateLimitStore(store);
  rl.__setFallbackWarn((m, e) => warns.push([m, e]));
  return { store, warns };
}

test.afterEach(() => {
  rl.__setRateLimitStore(null);
  rl.__setFallbackWarn(null);
  rl.__resetAllBuckets();
});

test('固定窗口计数：前 max 次放行，之后拒绝并给出剩余秒数', async () => {
  const { store } = setup();
  for (let i = 1; i <= 3; i++) {
    const r = await rl.rateLimitAsync('register:ip:1.1.1.1', 3, 60_000);
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 3 - i);
  }
  store.clock.t += 20_000;
  const blocked = await rl.rateLimitAsync('register:ip:1.1.1.1', 3, 60_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 40); // 窗口从第一次计数起算，还剩 40 秒
  // 其它 key 互不影响
  assert.equal((await rl.rateLimitAsync('register:ip:2.2.2.2', 3, 60_000)).allowed, true);
});

test('窗口过期后计数重置，重新放行', async () => {
  const { store } = setup();
  for (let i = 0; i < 4; i++) await rl.rateLimitAsync('k', 3, 60_000);
  assert.equal((await rl.rateLimitAsync('k', 3, 60_000)).allowed, false);
  store.clock.t += 60_001;
  const r = await rl.rateLimitAsync('k', 3, 60_000);
  assert.equal(r.allowed, true);
  assert.equal(r.remaining, 2); // 新窗口里的第 1 次
});

test('rateLimitByKeyAsync 按 scope+id 独立计数', async () => {
  setup();
  for (let i = 0; i < 3; i++) assert.equal((await rl.rateLimitByKeyAsync('ai-chat', 'u1', 3, 60_000)).allowed, true);
  assert.equal((await rl.rateLimitByKeyAsync('ai-chat', 'u1', 3, 60_000)).allowed, false);
  assert.equal((await rl.rateLimitByKeyAsync('ai-chat', 'u2', 3, 60_000)).allowed, true);
  assert.equal((await rl.rateLimitByKeyAsync('ai-analyze', 'u1', 3, 60_000)).allowed, true);
});

test('登录锁：失败才计数（isRateLimitedAsync 只查不计），达到上限锁定，重置后解除', async () => {
  const { store } = setup();
  const key = rl.loginLockKey('Admin', '1.1.1.1');
  for (let i = 0; i < 4; i++) {
    assert.equal((await rl.isRateLimitedAsync(key, 5, 900_000)).allowed, true);
    await rl.bumpRateLimitAsync(key, 900_000);
  }
  // 反复只查不计，不会推进计数
  for (let i = 0; i < 10; i++) await rl.isRateLimitedAsync(key, 5, 900_000);
  assert.equal(store.rows.size, 1);
  assert.equal([...store.rows.values()][0].count, 4);

  await rl.bumpRateLimitAsync(key, 900_000); // 第 5 次失败
  const locked = await rl.isRateLimitedAsync(key, 5, 900_000);
  assert.equal(locked.allowed, false);
  assert.ok(locked.retryAfterSec > 0 && locked.retryAfterSec <= 900);
  // 另一个 IP 上的同名账号不受影响
  assert.equal((await rl.isRateLimitedAsync(rl.loginLockKey('admin', '2.2.2.2'), 5, 900_000)).allowed, true);

  await rl.resetRateLimitAsync(key);
  assert.equal((await rl.isRateLimitedAsync(key, 5, 900_000)).allowed, true);
});

test('锁定窗口过期后自动解除', async () => {
  const { store } = setup();
  const key = rl.loginLockKey('bob', '3.3.3.3');
  for (let i = 0; i < 5; i++) await rl.bumpRateLimitAsync(key, 900_000);
  assert.equal((await rl.isRateLimitedAsync(key, 5, 900_000)).allowed, false);
  store.clock.t += 900_001;
  assert.equal((await rl.isRateLimitedAsync(key, 5, 900_000)).allowed, true);
});

test('两个「实例」共用同一存储时计数共享（多实例场景）', async () => {
  setup(); // 同一个 fake store 即「同一个数据库」
  // 模拟实例 A 与实例 B 各自的内存桶是空的，但共享存储：总数仍受 max 约束
  let allowed = 0;
  for (let i = 0; i < 6; i++) {
    rl.__resetAllBuckets(); // 每次换「实例」，内存桶清空
    if ((await rl.rateLimitAsync('shared', 4, 60_000)).allowed) allowed++;
  }
  assert.equal(allowed, 4);
});

test('DB 出错回退内存实现：限流仍然生效，且告警只打一次（不刷屏）', async () => {
  const { store, warns } = setup();
  store.failing = true;
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await rl.rateLimitAsync('fallback:k', 3, 60_000)).allowed);
  assert.deepEqual(results, [true, true, true, false, false]);
  assert.equal(warns.length, 1);
  assert.match(String(warns[0][0]), /退回进程内内存/);

  // isRateLimited / bump / reset 也都回退，不抛错
  await assert.doesNotReject(() => rl.bumpRateLimitAsync('fallback:lock', 60_000));
  for (let i = 0; i < 4; i++) await rl.bumpRateLimitAsync('fallback:lock', 60_000);
  assert.equal((await rl.isRateLimitedAsync('fallback:lock', 5, 60_000)).allowed, false);
  await assert.doesNotReject(() => rl.resetRateLimitAsync('fallback:lock'));
  assert.equal((await rl.isRateLimitedAsync('fallback:lock', 5, 60_000)).allowed, true);
  assert.equal(warns.length, 1, '同一分钟内的后续失败不再重复告警');
});

test('DB 恢复后重新走持久化计数', async () => {
  const { store } = setup();
  store.failing = true;
  await rl.rateLimitAsync('recover:k', 3, 60_000);
  store.failing = false;
  rl.__setFallbackWarn(() => {});
  const r = await rl.rateLimitAsync('recover:k', 3, 60_000);
  assert.equal(r.allowed, true);
  assert.equal(store.rows.size, 1, '恢复后计数落到存储');
});

test('没有持久存储（null）时静默使用内存实现', async () => {
  rl.__resetAllBuckets();
  rl.__setRateLimitStore(null);
  const warns = [];
  rl.__setFallbackWarn((m) => warns.push(m));
  for (let i = 0; i < 3; i++) assert.equal((await rl.rateLimitAsync('mem:k', 3, 60_000)).allowed, true);
  assert.equal((await rl.rateLimitAsync('mem:k', 3, 60_000)).allowed, false);
  assert.equal(warns.length, 0);
});

test('存库 key 不含明文用户名 / IP，只保留 scope 前缀，且确定性', () => {
  const k = rl.storageKey(rl.loginLockKey('Admin', '1.2.3.4'));
  assert.match(k, /^login:[0-9a-f]{32}$/);
  assert.ok(!k.includes('admin') && !k.includes('1.2.3.4'));
  assert.equal(k, rl.storageKey(rl.loginLockKey('admin', '1.2.3.4')));
  assert.notEqual(k, rl.storageKey(rl.loginLockKey('admin', '1.2.3.5')));
  assert.match(rl.storageKey('register:ip:9.9.9.9'), /^register:[0-9a-f]{32}$/);
  assert.match(rl.storageKey('ai-chat:user-1'), /^ai-chat:[0-9a-f]{32}$/);
});
