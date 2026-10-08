import assert from 'node:assert/strict';
import test from 'node:test';

const core = await import('../lib/pending-recovery-core.ts');
const pendingFetch = await import('../lib/pending-fetch.ts');

const TASK = 7;

/** 内存版本地图库：和 Dexie 的 images 表对补拉用到的四个操作等价 */
function makeStore(initial = []) {
  let nextId = 1;
  const rows = initial.map(row => ({ id: nextId++, projectId: TASK, ...row }));
  return {
    rows,
    api: {
      list: async taskId => rows.filter(r => r.projectId === taskId).map(r => ({ ...r })),
      add: async image => {
        const row = { id: nextId++, ...image };
        rows.push(row);
        return row.id;
      },
      setType: async (id, type) => {
        const row = rows.find(r => r.id === id);
        if (row) row.type = type;
      },
      remove: async id => {
        const index = rows.findIndex(r => r.id === id);
        if (index >= 0) rows.splice(index, 1);
      },
    },
  };
}

function makeDeps({ store, pending = [], outcomes = {}, listFailures = 0 }) {
  const calls = { fetch: [], release: [], sleeps: [], errors: [], logs: [], list: 0 };
  let remainingListFailures = listFailures;
  const deps = {
    listPending: async () => {
      calls.list++;
      if (remainingListFailures > 0) {
        remainingListFailures--;
        throw new Error('HTTP 503');
      }
      return pending;
    },
    fetchImage: async id => {
      calls.fetch.push(id);
      const outcome = outcomes[id];
      return typeof outcome === 'function' ? outcome() : outcome ?? { status: 'failed' };
    },
    release: id => { calls.release.push(id); },
    store: store.api,
    sleep: async ms => { calls.sleeps.push(ms); },
    attempts: 3,
    listTimeoutMs: 1000,
    log: {
      log: (...args) => calls.logs.push(args.join(' ')),
      error: (...args) => calls.errors.push(args.join(' ')),
    },
  };
  return { deps, calls };
}

const img = (data, extra = {}) => ({ status: 'ok', image: { data, mimeType: 'image/png', width: 1, height: 1, ...extra } });
const meta = (id, shotIndex, kind = 'result') => ({ id, kind, shotIndex, width: 1, height: 1 });

test('fetchPendingImageOutcome: 404 is "gone" and is not retried; 5xx exhausts retries as "failed"', async () => {
  let gone404Calls = 0;
  const gone = await pendingFetch.fetchPendingImageOutcome('p1', {
    attempts: 3,
    retryDelayMs: () => 0,
    fetchImpl: async () => { gone404Calls++; return { status: 404, ok: false, json: async () => ({}) }; },
  });
  assert.deepEqual(gone, { status: 'gone' });
  assert.equal(gone404Calls, 1);

  let failedCalls = 0;
  const failed = await pendingFetch.fetchPendingImageOutcome('p2', {
    attempts: 2,
    retryDelayMs: () => 0,
    fetchImpl: async () => { failedCalls++; return { status: 503, ok: false, json: async () => ({}) }; },
  });
  assert.deepEqual(failed, { status: 'failed' });
  assert.equal(failedCalls, 2);

  // 旧入口行为不变：gone / failed 都是 null
  assert.equal(await pendingFetch.fetchPendingImageWithRetry('p3', {
    attempts: 1,
    fetchImpl: async () => ({ status: 404, ok: false, json: async () => ({}) }),
  }), null);
});

test('RACE: pending already taken by the SSE delivery path (404) is skipped, not reported as a recovery failure', async () => {
  // SSE 正常交付：图已落库并发出 DELETE；补拉的列表恰好在 DELETE 之前取到，随后取图 404
  const store = makeStore([{ type: 'result', shotIndex: 3, data: 'NEW-PAID-IMAGE', mimeType: 'image/png' }]);
  const { deps, calls } = makeDeps({
    store,
    pending: [meta('gone-id', 3)],
    outcomes: { 'gone-id': { status: 'gone' } },
  });

  const result = await core.recoverPending(deps, TASK, [3]);

  assert.deepEqual(result, { ok: true, recoveredShotIndexes: [] });
  assert.equal(calls.list, 1, 'no retry round');
  assert.deepEqual(calls.sleeps, [], 'no retry backoff');
  assert.deepEqual(calls.errors, [], 'no 补拉失败 error log');
  assert.deepEqual(calls.fetch, ['gone-id']);
  assert.deepEqual(calls.release, [], 'nothing to release: someone else already deleted it');
  // 用户刚付费的新图原封不动
  assert.deepEqual(store.rows.map(r => [r.type, r.shotIndex, r.data]), [['result', 3, 'NEW-PAID-IMAGE']]);
});

test('RACE: gone pending never deletes or demotes a paid image, even with a backup next to it', async () => {
  const store = makeStore([
    { type: 'result', shotIndex: 2, data: 'NEW', mimeType: 'image/png' },
    { type: 'result_backup', shotIndex: 2, data: 'OLD', mimeType: 'image/png' },
  ]);
  const { deps } = makeDeps({
    store,
    pending: [meta('a', 2)],
    outcomes: { a: { status: 'gone' } },
  });
  await core.recoverPending(deps, TASK);
  assert.deepEqual(store.rows.map(r => [r.type, r.data]), [['result', 'NEW'], ['result_backup', 'OLD']]);
});

test('a genuinely failed fetch still counts as a failure, retries, and reports ok:false', async () => {
  const store = makeStore();
  const { deps, calls } = makeDeps({
    store,
    pending: [meta('x', 1)],
    outcomes: { x: { status: 'failed' } },
  });
  const result = await core.recoverPending(deps, TASK);
  assert.equal(result.ok, false);
  assert.equal(calls.list, 3);
  assert.deepEqual(calls.sleeps, [1000, 2000]);
  assert.equal(calls.errors.length, 3);
  assert.deepEqual(store.rows, []);
});

test('a gone pending next to a recoverable one: the recoverable image is still brought back', async () => {
  const store = makeStore();
  const { deps, calls } = makeDeps({
    store,
    pending: [meta('gone-id', 1), meta('live-id', 2)],
    outcomes: { 'gone-id': { status: 'gone' }, 'live-id': img('IMG2') },
  });
  const result = await core.recoverPending(deps, TASK);
  assert.deepEqual(result, { ok: true, recoveredShotIndexes: [2] });
  assert.deepEqual(store.rows.map(r => [r.type, r.shotIndex, r.data]), [['result', 2, 'IMG2']]);
  assert.deepEqual(calls.release, ['live-id']);
});

test('identical pending vs local result is a duplicate: released, nothing added', async () => {
  const store = makeStore([{ type: 'result', shotIndex: 1, data: 'SAME', mimeType: 'image/png' }]);
  const { deps, calls } = makeDeps({ store, pending: [meta('d', 1)], outcomes: { d: img('SAME') } });
  const result = await core.recoverPending(deps, TASK);
  assert.deepEqual(result, { ok: true, recoveredShotIndexes: [] });
  assert.equal(store.rows.length, 1);
  assert.deepEqual(calls.release, ['d']);
});

test('different pending vs local result (7352899 regression): old image is demoted to backup, new paid image kept as result', async () => {
  const store = makeStore([
    { type: 'result', shotIndex: 1, data: 'OLD', mimeType: 'image/png' },
    { type: 'result_backup', shotIndex: 1, data: 'STALE-BACKUP', mimeType: 'image/png' },
  ]);
  const { deps } = makeDeps({ store, pending: [meta('n', 1)], outcomes: { n: img('NEW') } });
  const result = await core.recoverPending(deps, TASK);
  assert.deepEqual(result, { ok: true, recoveredShotIndexes: [1] });
  const byType = Object.fromEntries(store.rows.map(r => [r.type, r.data]));
  assert.equal(byType.result, 'NEW');
  assert.equal(byType.result_backup, 'OLD');
  assert.equal(store.rows.length, 2, 'stale backup replaced, nothing else lost');
});

test('concurrent recoveries for one task are serialized: the same pending image is stored once', async () => {
  const store = makeStore();
  let fetches = 0;
  const { deps, calls } = makeDeps({
    store,
    pending: [meta('shared', 4)],
    outcomes: {
      shared: async () => {
        fetches++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return img('ONLY-ONCE');
      },
    },
  });
  const [a, b] = await Promise.all([core.recoverPending(deps, TASK), core.recoverPending(deps, TASK)]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(fetches, 2, 'second run still fetches (the DELETE may not have landed) ...');
  assert.equal(store.rows.filter(r => r.type === 'result' && r.shotIndex === 4).length, 1, '... but never duplicates the row');
  assert.equal(calls.release.length, 2);
});

test('anchors: gone is skipped quietly; failed is logged and skipped; existing anchor releases the pending one', async () => {
  const store = makeStore();
  const { deps, calls } = makeDeps({
    store,
    pending: [meta('anchor-gone', 0, 'anchor')],
    outcomes: { 'anchor-gone': { status: 'gone' } },
  });
  assert.equal((await core.recoverPending(deps, TASK)).ok, true);
  assert.deepEqual(calls.errors, []);
  assert.equal(store.rows.length, 0);

  const failedStore = makeStore();
  const failedCase = makeDeps({
    store: failedStore,
    pending: [meta('anchor-bad', 0, 'anchor')],
    outcomes: { 'anchor-bad': { status: 'failed' } },
  });
  assert.equal((await core.recoverPending(failedCase.deps, TASK)).ok, true);
  assert.equal(failedCase.calls.errors.length, 1);

  const haveStore = makeStore([{ type: 'anchor', data: 'A', mimeType: 'image/png' }]);
  const haveCase = makeDeps({ store: haveStore, pending: [meta('anchor-dup', 0, 'anchor')] });
  await core.recoverPending(haveCase.deps, TASK);
  assert.deepEqual(haveCase.calls.release, ['anchor-dup']);
  assert.deepEqual(haveCase.calls.fetch, []);
});
