import assert from 'node:assert/strict';
import test from 'node:test';

// lib/db.ts 只依赖 dexie（Node 下 import 不会打开 IndexedDB），可以直接测纯函数。
// lib/image-library.ts 用了无扩展名的相对 import，Node 解析不了，
// 所以去重指纹 / 配额识别这类纯逻辑放在 db.ts，由这里覆盖；Dexie 的 count()/游标读取需浏览器实测。
const {
  isStorageQuotaError,
  StorageQuotaError,
  withQuotaGuard,
  libraryFingerprint,
  dedupeByFingerprint,
  requestPersistentStorageOnce,
  STORAGE_FULL_MESSAGE,
} = await import('../lib/db.ts');

const named = (name, extra = {}) => Object.assign(new Error(name), { name }, extra);

test('isStorageQuotaError：直接的 QuotaExceededError / Firefox / 旧 code', () => {
  assert.equal(isStorageQuotaError(named('QuotaExceededError')), true);
  assert.equal(isStorageQuotaError(named('NS_ERROR_DOM_QUOTA_REACHED')), true);
  assert.equal(isStorageQuotaError({ name: 'Error', code: 22 }), true);
  assert.equal(isStorageQuotaError({ name: 'Error', code: 1014 }), true);
  assert.equal(isStorageQuotaError(new Error('The quota has been exceeded.')), true); // Chrome 的 message 措辞
  assert.equal(isStorageQuotaError(new Error('QuotaExceededError: disk full')), true);
});

test('isStorageQuotaError：Dexie 包装（AbortError / DatabaseClosedError 的 inner、BulkError.failures、cause）', () => {
  assert.equal(isStorageQuotaError(named('AbortError', { inner: named('QuotaExceededError') })), true);
  assert.equal(isStorageQuotaError(named('DatabaseClosedError', { inner: named('QuotaExceededError') })), true);
  assert.equal(
    isStorageQuotaError(named('BulkError', { failures: [named('ConstraintError'), named('QuotaExceededError')] })),
    true,
  );
  assert.equal(isStorageQuotaError(new Error('x', { cause: named('QuotaExceededError') })), true);
  // 两层嵌套
  assert.equal(
    isStorageQuotaError(named('AbortError', { inner: named('DatabaseClosedError', { inner: named('QuotaExceededError') }) })),
    true,
  );
});

test('isStorageQuotaError：无关错误、空值、环引用都返回 false 且不死循环', () => {
  assert.equal(isStorageQuotaError(named('AbortError', { inner: named('ConstraintError') })), false);
  assert.equal(isStorageQuotaError(named('NotFoundError')), false);
  assert.equal(isStorageQuotaError(null), false);
  assert.equal(isStorageQuotaError(undefined), false);
  assert.equal(isStorageQuotaError('QuotaExceededError'), false);
  const loop = named('AbortError');
  loop.inner = loop;
  assert.equal(isStorageQuotaError(loop), false);
});

test('withQuotaGuard：配额错误转成可识别的 StorageQuotaError，其余错误与成功值原样透传', async () => {
  const quota = named('AbortError', { inner: named('QuotaExceededError') });
  await assert.rejects(
    () => withQuotaGuard(async () => { throw quota; }),
    (e) => e instanceof StorageQuotaError && isStorageQuotaError(e) && e.message === STORAGE_FULL_MESSAGE && e.cause === quota,
  );
  const other = named('ConstraintError');
  await assert.rejects(() => withQuotaGuard(async () => { throw other; }), (e) => e === other);
  assert.equal(await withQuotaGuard(async () => 42), 42);
});

test('libraryFingerprint：头部相同但尾部 / 长度 / 尺寸不同的图不会被误判重复', () => {
  const head = 'A'.repeat(500);
  const base = { size: 1000, width: 800, height: 600, base64: head + 'tail-1' };
  const sameHeadDiffTail = { ...base, base64: head + 'tail-2' };
  const diffLen = { ...base, base64: head + 'xx' + 'tail-1' };
  const diffDim = { ...base, width: 801 };
  const keys = new Set([base, sameHeadDiffTail, diffLen, diffDim].map(libraryFingerprint));
  assert.equal(keys.size, 4);
  assert.equal(libraryFingerprint(base), libraryFingerprint({ ...base }));
});

test('dedupeByFingerprint：跳过图库已有的，也去掉同批内重复，保持原顺序', () => {
  const mk = (n) => ({ id: n, size: n, width: 10, height: 10, base64: `data-${n}` });
  const [a, b, c] = [mk(1), mk(2), mk(3)];
  const existing = new Set([libraryFingerprint(b)]);
  const { unique, skipped } = dedupeByFingerprint([a, b, c, { ...a }], existing);
  assert.deepEqual(unique.map((x) => x.id), [1, 3]);
  assert.equal(skipped, 2);

  const all = dedupeByFingerprint([a], new Set([libraryFingerprint(a)]));
  assert.deepEqual(all, { unique: [], skipped: 1 });
  assert.deepEqual(dedupeByFingerprint([], new Set()), { unique: [], skipped: 0 });
});

test('requestPersistentStorageOnce：只调用一次 navigator.storage.persist，且 persist 抛错 / 不存在都不外抛', async () => {
  // 注意：该函数在模块内有「已请求」标记，整个测试进程只会真正调用一次
  let calls = 0;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { storage: { persist: () => { calls += 1; return Promise.reject(new Error('denied')); } } },
  });
  try {
    requestPersistentStorageOnce();
    requestPersistentStorageOnce();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});
