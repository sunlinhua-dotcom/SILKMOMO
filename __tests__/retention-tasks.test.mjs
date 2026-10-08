import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const retention = await import('../lib/retention.ts');
const tasks = await import('../lib/retention-tasks.ts');

function makeCtx(overrides = {}) {
  return {
    dryRun: false,
    now: new Date('2026-10-08T00:00:00.000Z'),
    batchSize: 500,
    shouldStop: () => false,
    heartbeat: async () => { calls.heartbeat++; },
    sleep: async () => {},
    ...overrides,
  };
}
const calls = { heartbeat: 0 };

function makeOps(purgeResult = 7, countResult = 3) {
  const state = { purge: [], count: [] };
  return {
    state,
    ops: {
      async purge(now, batchSize) { state.purge.push({ now, batchSize }); return purgeResult; },
      async count(now) { state.count.push({ now }); return countResult; },
    },
  };
}

test('正式跑：调用 purge，带 now 与 batchSize，并做一次心跳', async () => {
  calls.heartbeat = 0;
  const { ops, state } = makeOps(7, 3);
  const ctx = makeCtx();
  const n = await tasks.createExpiredPurgeTask(ops)(ctx);
  assert.equal(n, 7);
  assert.equal(state.purge.length, 1);
  assert.equal(state.purge[0].batchSize, 500);
  assert.equal(state.purge[0].now, ctx.now);
  assert.equal(state.count.length, 0);
  assert.equal(calls.heartbeat, 1);
});

test('dry-run：只统计，绝不调用 purge', async () => {
  const { ops, state } = makeOps(7, 3);
  const n = await tasks.createExpiredPurgeTask(ops)(makeCtx({ dryRun: true }));
  assert.equal(n, 3);
  assert.equal(state.purge.length, 0);
  assert.equal(state.count.length, 1);
});

test('单轮时限已到：不删除，返回 0', async () => {
  const { ops, state } = makeOps();
  const n = await tasks.createExpiredPurgeTask(ops)(makeCtx({ shouldStop: () => true }));
  assert.equal(n, 0);
  assert.equal(state.purge.length, 0);
});

test('registerAuthRetentionTasks：两个任务按名字注册，重复调用幂等', () => {
  tasks.registerAuthRetentionTasks();
  tasks.registerAuthRetentionTasks();
  const names = retention.listRegisteredRetentionTasks().map(t => t.name);
  assert.equal(names.filter(n => n === tasks.REVOKED_TOKEN_TASK_NAME).length, 1);
  assert.equal(names.filter(n => n === tasks.RATE_LIMIT_COUNTER_TASK_NAME).length, 1);
  assert.equal(tasks.REVOKED_TOKEN_TASK_NAME, 'revokedToken');
  assert.equal(tasks.RATE_LIMIT_COUNTER_TASK_NAME, 'rateLimitCounter');
});

test('runRetention 会执行注册的任务，dry-run 汇总里带上它们的统计', async () => {
  const { ops, state } = makeOps(7, 3);
  const extraTasks = [{ name: 'revokedToken', run: tasks.createExpiredPurgeTask(ops) }];
  const store = {
    generationRecords: () => ({ count: async () => 0, listIds: async () => [], deleteIds: async () => 0 }),
    modelFaceJobs: () => ({ count: async () => 0, listIds: async () => [], deleteIds: async () => 0 }),
  };
  const lock = { runExclusive: async fn => ({ acquired: true, value: await fn(async () => {}) }) };
  const config = { disabled: false, dryRun: true, generationRecordDays: 365, modelFaceJobDays: 30, batchSize: 500 };
  const summary = await retention.runRetention({ store, lock, config, extraTasks });
  assert.equal(summary.counts.revokedToken, 3);
  assert.equal(state.purge.length, 0);
});

test('instrumentation.ts：注册先于调度器启动', () => {
  const src = readFileSync(new URL('../instrumentation.ts', import.meta.url), 'utf8');
  const reg = src.indexOf('registerAuthRetentionTasks()');
  const start = src.indexOf('startRetentionScheduler()');
  assert.ok(reg > 0, '应调用 registerAuthRetentionTasks()');
  assert.ok(start > 0, '应调用 startRetentionScheduler()');
  assert.ok(reg < start, '注册必须在调度器启动之前');
});

test('admin/setup 使用持久化限流并 await', () => {
  const src = readFileSync(new URL('../app/api/admin/setup/route.ts', import.meta.url), 'utf8');
  assert.match(src, /await rateLimitAsync\(/);
  assert.doesNotMatch(src, /[^a-zA-Z]rateLimit\(/);
});
