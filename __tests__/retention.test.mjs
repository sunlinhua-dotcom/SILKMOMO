import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const retention = await import('../lib/retention.ts');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-08T00:00:00.000Z');

const baseConfig = {
  disabled: false,
  dryRun: false,
  generationRecordDays: 365,
  modelFaceJobDays: 30,
  batchSize: 500,
};

/** 内存里的「可删行」仓库：只关心 id 与批次行为，where 语义由真实库测试（retention-db.test.mjs）覆盖。 */
function createFakePurgeOps(total) {
  const state = { remaining: total, listCalls: [], deleteCalls: [], countCalls: 0 };
  const ops = {
    count: async () => { state.countCalls++; return state.remaining; },
    listIds: async limit => {
      state.listCalls.push(limit);
      return Array.from({ length: Math.min(limit, state.remaining) }, (_, i) => `id-${i}`);
    },
    deleteIds: async ids => {
      state.deleteCalls.push(ids.length);
      state.remaining -= ids.length;
      return ids.length;
    },
  };
  return { ops, state };
}

function createFakeStore({ generationRecords = 0, modelFaceJobs = 0 } = {}) {
  const gen = createFakePurgeOps(generationRecords);
  const job = createFakePurgeOps(modelFaceJobs);
  const cutoffs = {};
  return {
    gen: gen.state,
    job: job.state,
    cutoffs,
    store: {
      generationRecords: cutoff => { cutoffs.generationRecord = cutoff; return gen.ops; },
      modelFaceJobs: cutoff => { cutoffs.modelFaceJob = cutoff; return job.ops; },
    },
  };
}

function createFakeLock({ acquired = true, heartbeat = async () => {} } = {}) {
  const state = { attempts: 0, heartbeats: 0 };
  return {
    state,
    lock: {
      async runExclusive(fn) {
        state.attempts++;
        if (!acquired) return { acquired: false };
        return { acquired: true, value: await fn(async () => { state.heartbeats++; await heartbeat(); }) };
      },
    },
  };
}

function run(overrides = {}) {
  const logs = [];
  const sleeps = [];
  const fakeStore = overrides.fakeStore ?? createFakeStore();
  const fakeLock = overrides.fakeLock ?? createFakeLock();
  const promise = retention.runRetention({
    store: fakeStore.store,
    lock: fakeLock.lock,
    config: { ...baseConfig, ...overrides.config },
    extraTasks: overrides.extraTasks ?? [],
    now: overrides.now ?? (() => NOW),
    sleep: async ms => { sleeps.push(ms); },
    log: (message, data) => logs.push({ message, data }),
    maxRunMs: overrides.maxRunMs,
  });
  return { promise, logs, sleeps, fakeStore, fakeLock };
}

test('deletes in batches of at most 500 rows and yields between batches', async () => {
  const fakeStore = createFakeStore({ generationRecords: 1250, modelFaceJobs: 501 });
  const { promise, sleeps } = run({ fakeStore });
  const summary = await promise;

  assert.deepEqual(fakeStore.gen.deleteCalls, [500, 500, 250]);
  assert.ok(fakeStore.gen.listCalls.every(limit => limit === 500));
  assert.deepEqual(fakeStore.job.deleteCalls, [500, 1]);
  assert.equal(summary.counts.generationRecord, 1250);
  assert.equal(summary.counts.modelFaceJob, 501);
  // generationRecord 两次批间停顿 + modelFaceJob 一次
  assert.equal(sleeps.length, 3);
  assert.ok(sleeps.every(ms => ms > 0));
  assert.deepEqual(summary.errors, {});
});

test('prints exactly one summary line with per-table counts', async () => {
  const fakeStore = createFakeStore({ generationRecords: 3, modelFaceJobs: 2 });
  const { promise, logs } = run({ fakeStore });
  await promise;

  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'done');
  assert.equal(logs[0].data.generationRecord, 3);
  assert.equal(logs[0].data.modelFaceJob, 2);
  assert.equal(logs[0].data.dryRun, false);
});

test('retention windows: cutoffs are exactly N days before now and configurable', async () => {
  const fakeStore = createFakeStore();
  await run({ fakeStore }).promise;
  assert.equal(fakeStore.cutoffs.generationRecord.getTime(), NOW - 365 * DAY_MS);
  assert.equal(fakeStore.cutoffs.modelFaceJob.getTime(), NOW - 30 * DAY_MS);

  const custom = createFakeStore();
  await run({ fakeStore: custom, config: { generationRecordDays: 90, modelFaceJobDays: 7 } }).promise;
  assert.equal(custom.cutoffs.generationRecord.getTime(), NOW - 90 * DAY_MS);
  assert.equal(custom.cutoffs.modelFaceJob.getTime(), NOW - 7 * DAY_MS);
});

test('dry run counts but never lists or deletes', async () => {
  const fakeStore = createFakeStore({ generationRecords: 700, modelFaceJobs: 9 });
  const { promise, logs } = run({ fakeStore, config: { dryRun: true } });
  const summary = await promise;

  assert.equal(summary.dryRun, true);
  assert.equal(summary.counts.generationRecord, 700);
  assert.equal(summary.counts.modelFaceJob, 9);
  assert.deepEqual(fakeStore.gen.deleteCalls, []);
  assert.deepEqual(fakeStore.job.deleteCalls, []);
  assert.deepEqual(fakeStore.gen.listCalls, []);
  assert.equal(fakeStore.gen.remaining, 700);
  assert.equal(logs[0].data.dryRun, true);
});

test('skips the whole run when the advisory lock cannot be acquired', async () => {
  const fakeStore = createFakeStore({ generationRecords: 10, modelFaceJobs: 10 });
  const fakeLock = createFakeLock({ acquired: false });
  const extraCalls = [];
  const { promise, logs } = run({
    fakeStore,
    fakeLock,
    extraTasks: [{ name: 'extra', run: async () => { extraCalls.push(1); return 1; } }],
  });
  const summary = await promise;

  assert.equal(summary.skipped, 'lock');
  assert.equal(fakeLock.state.attempts, 1);
  assert.deepEqual(fakeStore.gen.deleteCalls, []);
  assert.deepEqual(fakeStore.gen.listCalls, []);
  assert.deepEqual(fakeStore.job.deleteCalls, []);
  assert.deepEqual(extraCalls, []);
  assert.equal(logs[0].message, 'skipped_lock_held');
});

test('RETENTION_DISABLED style config does nothing and does not even try the lock', async () => {
  const fakeStore = createFakeStore({ generationRecords: 10 });
  const fakeLock = createFakeLock();
  const summary = await run({ fakeStore, fakeLock, config: { disabled: true } }).promise;

  assert.equal(summary.skipped, 'disabled');
  assert.equal(fakeLock.state.attempts, 0);
  assert.deepEqual(fakeStore.gen.listCalls, []);
});

test('extra tasks run with the same context, are isolated from each other, and show up in the summary', async () => {
  const fakeStore = createFakeStore({ generationRecords: 1 });
  const seen = [];
  const extraTasks = [
    { name: 'purgeA', run: async ctx => { seen.push(['purgeA', ctx.dryRun, ctx.batchSize]); return 7; } },
    { name: 'boom', run: async () => { throw new Error('db hiccup'); } },
    { name: 'purgeC', run: async () => { seen.push(['purgeC']); } },
  ];
  const summary = await run({ fakeStore, extraTasks, config: { dryRun: true } }).promise;

  assert.deepEqual(seen, [['purgeA', true, 500], ['purgeC']]);
  assert.equal(summary.counts.purgeA, 7);
  assert.equal(summary.counts.purgeC, 0);
  assert.equal(summary.counts.generationRecord, 1);
  assert.equal(summary.errors.boom, 'db hiccup');
  assert.equal(Object.keys(summary.errors).length, 1);
});

test('registerRetentionTask feeds tasks into the default run and same name overrides', async () => {
  const calls = [];
  retention.registerRetentionTask('t3-first', async () => { calls.push('first'); return 1; });
  retention.registerRetentionTask('t3-first', async () => { calls.push('second'); return 2; });
  try {
    const logs = [];
    const summary = await retention.runRetention({
      store: createFakeStore().store,
      lock: createFakeLock().lock,
      config: baseConfig,
      now: () => NOW,
      sleep: async () => {},
      log: (message, data) => logs.push({ message, data }),
    });
    assert.deepEqual(calls, ['second']);
    assert.equal(summary.counts['t3-first'], 2);
  } finally {
    // 清理全局注册表，避免污染同进程的其它测试
    globalThis.__silkmomoRetentionTasks.delete('t3-first');
  }
  assert.throws(() => retention.registerRetentionTask('', async () => {}));
});

test('stops starting new batches once the run deadline is reached', async () => {
  let clock = NOW;
  const fakeStore = createFakeStore({ generationRecords: 5000, modelFaceJobs: 100 });
  const original = fakeStore.store.generationRecords;
  fakeStore.store.generationRecords = cutoff => {
    const ops = original(cutoff);
    return { ...ops, deleteIds: async ids => { clock += 60_000; return ops.deleteIds(ids); } };
  };
  const summary = await run({ fakeStore, now: () => clock, maxRunMs: 150_000 }).promise;

  assert.equal(summary.stoppedEarly, true);
  assert.equal(fakeStore.gen.deleteCalls.length, 3); // 第 3 批之后已超时
  assert.deepEqual(fakeStore.job.deleteCalls, []); // 超时后后续任务不再开始新批
});

test('a lost lock lease aborts the run instead of deleting without the lock', async () => {
  const fakeStore = createFakeStore({ generationRecords: 100, modelFaceJobs: 100 });
  const fakeLock = createFakeLock({
    heartbeat: async () => { throw new retention.RetentionLeaseLostError(); },
  });
  const extraCalls = [];
  const summary = await run({
    fakeStore,
    fakeLock,
    extraTasks: [{ name: 'extra', run: async () => { extraCalls.push(1); } }],
  }).promise;

  assert.deepEqual(fakeStore.gen.deleteCalls, []);
  assert.deepEqual(fakeStore.job.deleteCalls, []);
  assert.deepEqual(extraCalls, []);
  assert.match(summary.errors.generationRecord, /lease lost/);
});

test('a batch that deletes nothing ends the loop instead of spinning', async () => {
  const stuck = { listCalls: 0 };
  const store = {
    generationRecords: () => ({
      count: async () => 1,
      listIds: async () => { stuck.listCalls++; return ['a', 'b']; },
      deleteIds: async () => 0, // 并发改了状态，一行也没删掉
    }),
    modelFaceJobs: () => createFakePurgeOps(0).ops,
  };
  const summary = await retention.runRetention({
    store, lock: createFakeLock().lock, config: { ...baseConfig, batchSize: 2 }, extraTasks: [], now: () => NOW, sleep: async () => {},
  });

  assert.equal(stuck.listCalls, 1);
  assert.equal(summary.counts.generationRecord, 0);
});

test('readRetentionConfig: defaults, overrides, switches and invalid values', () => {
  const warnings = [];
  const warn = msg => warnings.push(msg);

  assert.deepEqual(retention.readRetentionConfig({}, warn), baseConfig);

  const custom = retention.readRetentionConfig({
    GENERATION_RECORD_RETENTION_DAYS: '180',
    MODEL_FACE_JOB_RETENTION_DAYS: '14',
    RETENTION_DRY_RUN: '1',
    RETENTION_DISABLED: 'true',
  }, warn);
  assert.equal(custom.generationRecordDays, 180);
  assert.equal(custom.modelFaceJobDays, 14);
  assert.equal(custom.dryRun, true);
  assert.equal(custom.disabled, true);
  assert.equal(warnings.length, 0);

  for (const bad of ['0', '-5', 'abc', '1.5', '30d']) {
    const config = retention.readRetentionConfig({ GENERATION_RECORD_RETENTION_DAYS: bad, MODEL_FACE_JOB_RETENTION_DAYS: bad }, warn);
    assert.equal(config.generationRecordDays, 365, `bad value ${bad}`);
    assert.equal(config.modelFaceJobDays, 30, `bad value ${bad}`);
  }
  assert.equal(warnings.length, 10);
  assert.equal(retention.readRetentionConfig({ RETENTION_DRY_RUN: '0', RETENTION_DISABLED: '' }).dryRun, false);
});

test('where clauses: generation records keep anything rated or with feedback', () => {
  const cutoff = new Date(NOW);
  assert.deepEqual(retention.generationRecordRetentionWhere(cutoff), {
    createdAt: { lt: cutoff },
    rating: 0,
    feedback: '',
    feedbackTags: '[]',
  });
});

test('where clauses: a job is only purgeable when no item is in a non-terminal billing state', () => {
  const cutoff = new Date(NOW);
  const where = retention.modelFaceJobRetentionWhere(cutoff);
  assert.deepEqual(where.status, { in: ['completed', 'failed'] });
  assert.deepEqual(where.finishedAt, { lt: cutoff });
  assert.deepEqual(where.items, { none: { billingStatus: { notIn: ['uncharged', 'refunded', 'kept'] } } });
  for (const nonTerminal of ['charged', 'refund_pending']) {
    assert.equal(retention.MODEL_FACE_TERMINAL_BILLING_STATUSES.includes(nonTerminal), false);
  }
});

test('schema guard: every ModelFaceBillingStatus is classified; a new enum value forces a decision here', () => {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const block = schema.match(/enum ModelFaceBillingStatus \{([^}]*)\}/);
  assert.ok(block, 'enum ModelFaceBillingStatus not found');
  const values = block[1].split('\n').map(line => line.trim()).filter(Boolean);
  const nonTerminal = values.filter(value => !retention.MODEL_FACE_TERMINAL_BILLING_STATUSES.includes(value));
  assert.deepEqual(nonTerminal.sort(), ['charged', 'refund_pending']);
  for (const terminal of retention.MODEL_FACE_TERMINAL_BILLING_STATUSES) assert.ok(values.includes(terminal));
});

test('the Prisma store re-applies the retention condition on delete (guards the list/delete race)', async () => {
  const calls = [];
  const delegate = {
    findMany: async args => { calls.push(['findMany', args]); return [{ id: 'a' }, { id: 'b' }]; },
    deleteMany: async args => { calls.push(['deleteMany', args]); return { count: 2 }; },
    count: async args => { calls.push(['count', args]); return 2; },
  };
  const store = retention.createPrismaRetentionStore({
    generationRecord: delegate,
    modelFaceGenerationJob: delegate,
    $transaction: async () => { throw new Error('unused'); },
  });
  const cutoff = new Date(NOW);
  const ops = store.generationRecords(cutoff);
  assert.deepEqual(await ops.listIds(500), ['a', 'b']);
  assert.equal(await ops.deleteIds(['a', 'b']), 2);
  assert.equal(await ops.count(), 2);

  const where = retention.generationRecordRetentionWhere(cutoff);
  assert.deepEqual(calls[0][1].where, where);
  assert.equal(calls[0][1].take, 500);
  assert.deepEqual(calls[1][1].where, { AND: [{ id: { in: ['a', 'b'] } }, where] });
});

test('the advisory lock skips fn when pg_try_advisory_xact_lock returns false and runs it when true', async () => {
  const queries = [];
  const makePrisma = locked => ({
    $transaction: async (fn, options) => {
      assert.ok(options.timeout > retention.RETENTION_MAX_RUN_MS, 'lease must outlive the run deadline');
      return fn({ $queryRawUnsafe: async query => { queries.push(query); return [{ locked }]; } });
    },
  });

  let ran = 0;
  const denied = await retention.createAdvisoryLock(makePrisma(false)).runExclusive(async () => { ran++; return 'x'; });
  assert.deepEqual(denied, { acquired: false });
  assert.equal(ran, 0);

  const granted = await retention.createAdvisoryLock(makePrisma(true)).runExclusive(async heartbeat => {
    await heartbeat();
    ran++;
    return 'ok';
  });
  assert.deepEqual(granted, { acquired: true, value: 'ok' });
  assert.equal(ran, 1);
  assert.ok(queries[0].includes('pg_try_advisory_xact_lock'));
  assert.ok(queries.includes('SELECT 1'));
});
