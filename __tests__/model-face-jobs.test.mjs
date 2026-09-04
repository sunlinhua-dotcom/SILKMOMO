import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const runner = await import('../lib/model-face-job-runner.ts');
const billing = await import('../lib/billing-constants.ts');
const policy = await import('../lib/model-face-job-policy.ts').catch(() => ({}));

function fakeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      deduct: async () => { calls.push('deduct'); return { success: true }; },
      markAttempt: async () => { calls.push('attempt'); return { success: true }; },
      generate: async () => { calls.push('generate'); return { success: true, data: 'image-data', mimeType: 'image/png' }; },
      store: async () => { calls.push('store'); return { id: 'face-1' }; },
      refund: async () => { calls.push('refund'); return { success: true, status: 'refunded' }; },
      ...overrides,
    },
  };
}

test('successful model face keeps the GPT Image 2 medium charge and persists immediately', async () => {
  const { calls, deps } = fakeDeps();
  const result = await runner.generateChargedModelFace({
    userId: 'u1', specIndex: 2, costFen: billing.getGenerationCostFen('openai', 'medium'), billingStatus: 'uncharged',
  }, deps);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.faceId, 'face-1');
  assert.equal(result.costFen, 120);
  assert.deepEqual(calls, ['deduct', 'attempt', 'generate', 'store']);
});

test('failed model face is refunded and is never stored', async () => {
  const { calls, deps } = fakeDeps({
    generate: async () => { calls.push('generate'); return { success: false, error: 'timeout' }; },
  });
  const result = await runner.generateChargedModelFace({ userId: 'u1', specIndex: 0, costFen: 120, billingStatus: 'uncharged' }, deps);

  assert.equal(result.status, 'failed');
  assert.equal(result.refundStatus, 'refunded');
  assert.deepEqual(calls, ['deduct', 'attempt', 'generate', 'refund']);
});

test('insufficient balance starts no generation and needs no refund', async () => {
  const { calls, deps } = fakeDeps({
    deduct: async () => { calls.push('deduct'); return { success: false, error: '余额不足' }; },
  });
  const result = await runner.generateChargedModelFace({ userId: 'u1', specIndex: 0, costFen: 120, billingStatus: 'uncharged' }, deps);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(calls, ['deduct']);
});

test('a recovered charged item continues without a second deduction', async () => {
  const { calls, deps } = fakeDeps();
  const result = await runner.generateChargedModelFace({
    userId: 'u1', specIndex: 0, costFen: 120, billingStatus: 'charged',
  }, deps);

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(calls, ['attempt', 'generate', 'store']);
});

test('refund failure stays refund_pending and is never reported as refunded', async () => {
  const { deps } = fakeDeps({
    generate: async () => ({ success: false, error: 'timeout' }),
    refund: async () => ({ success: false, status: 'refund_pending', error: 'db unavailable' }),
  });
  const result = await runner.generateChargedModelFace({
    userId: 'u1', specIndex: 0, costFen: 120, billingStatus: 'charged',
  }, deps);

  assert.equal(result.status, 'failed');
  assert.equal(result.refundStatus, 'refund_pending');
});

test('markAttempt exception is refunded and never reaches the upstream generator', async () => {
  const { calls, deps } = fakeDeps({
    markAttempt: async () => { calls.push('attempt'); throw new Error('P2028 transaction expired'); },
  });
  const result = await runner.generateChargedModelFace({
    userId: 'u1', specIndex: 0, costFen: 120, billingStatus: 'charged',
  }, deps);

  assert.equal(result.status, 'failed');
  assert.equal(result.refundStatus, 'refunded');
  assert.equal(result.error, 'P2028 transaction expired');
  assert.deepEqual(calls, ['attempt', 'refund']);
});

test('job summary keeps refund reconciliation visible until every refund commits', () => {
  assert.equal(typeof runner.buildModelFaceJobError, 'function');
  assert.equal(runner.buildModelFaceJobError(2, 1), '2 张失败，1 张退款处理中');
  assert.equal(runner.buildModelFaceJobError(2, 0), '2 张失败，已退款');
  assert.equal(runner.buildModelFaceJobError(0, 0), null);
});

test('interrupted attempted charges refund before the item becomes terminal', async () => {
  const calls = [];
  const result = await runner.reconcileInterruptedModelFaceItem({
    billingStatus: 'charged', attemptedAt: new Date('2026-09-04T01:00:00Z'), faceId: null,
  }, {
    refund: async () => { calls.push('refund'); return { success: true, status: 'refunded' }; },
  });

  assert.deepEqual(calls, ['refund']);
  assert.deepEqual(result, { itemStatus: 'failed', billingStatus: 'refunded' });
});

test('an interrupted pre-attempt charge remains charged and resumes without refund', async () => {
  const calls = [];
  const result = await runner.reconcileInterruptedModelFaceItem({
    billingStatus: 'charged', attemptedAt: null, faceId: null,
  }, {
    refund: async () => { calls.push('refund'); return { success: true, status: 'refunded' }; },
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { itemStatus: 'pending', billingStatus: 'charged' });
});

test('lease heartbeat renews on schedule and exposes a lost lease with fake timers', async () => {
  const scheduled = [];
  let renewals = 0;
  const heartbeat = runner.createModelFaceLeaseHeartbeat({
    intervalMs: 15_000,
    renew: async () => ++renewals < 2,
    setIntervalFn: callback => { scheduled.push(callback); return 7; },
    clearIntervalFn: id => { assert.equal(id, 7); },
  });

  assert.equal(scheduled.length, 1);
  await scheduled[0]();
  assert.equal(heartbeat.leaseLost(), false);
  await scheduled[0]();
  assert.equal(heartbeat.leaseLost(), true);
  heartbeat.stop();
});

test('daily attempt windows reset at UTC+8 midnight and cap actual attempts at 200', () => {
  assert.equal(typeof policy.startOfShanghaiDay, 'function');
  assert.equal(typeof policy.hasModelFaceAttemptCapacity, 'function');
  assert.equal(
    policy.startOfShanghaiDay(new Date('2026-09-04T15:59:59.999Z')).toISOString(),
    '2026-09-03T16:00:00.000Z',
  );
  assert.equal(
    policy.startOfShanghaiDay(new Date('2026-09-04T16:00:00.000Z')).toISOString(),
    '2026-09-04T16:00:00.000Z',
  );
  assert.equal(policy.hasModelFaceAttemptCapacity(199, 1), true);
  assert.equal(policy.hasModelFaceAttemptCapacity(199, 2), false);
  assert.equal(policy.hasModelFaceAttemptCapacity(200, 0), true);
});

test('model face jobs persist per-item state and enforce one active job per account', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(schema, /model ModelFaceGenerationJob \{/);
  assert.match(schema, /model ModelFaceGenerationItem \{/);
  assert.match(schema, /activeKey\s+String\?\s+@unique/);
  assert.match(schema, /items\s+ModelFaceGenerationItem\[\]/);
  assert.match(schema, /status\s+ModelFaceItemStatus\s+@default\(pending\)/);
  assert.match(schema, /billingKey\s+String\s+@unique/);
  assert.match(schema, /billingStatus\s+ModelFaceBillingStatus\s+@default\(uncharged\)/);
  assert.match(schema, /attemptedAt\s+DateTime\?/);
  assert.match(schema, /leaseUntil\s+DateTime\?/);
});

test('job API recovers interrupted work, has no library total cap, and caps real upstream attempts at 200 per UTC+8 day', () => {
  const route = fs.readFileSync('app/api/model-face/route.ts', 'utf8');
  const jobs = fs.readFileSync('lib/model-face-jobs.ts', 'utf8');
  const policySource = fs.readFileSync('lib/model-face-job-policy.ts', 'utf8');

  assert.match(route, /export async function GET/);
  assert.match(route, /return NextResponse\.json\(\{ jobId: job\.id \}/);
  assert.match(policySource, /export const DAILY_MODEL_FACE_LIMIT = 200/);
  assert.match(jobs, /hasModelFaceAttemptCapacity/);
  assert.match(jobs, /startOfShanghaiDay/);
  assert.match(jobs, /recoverInterruptedModelFaceJobs/);
  assert.doesNotMatch(jobs, /MODEL_FACE_LIBRARY_LIMIT|assertModelFaceLibraryCapacity|最多保存/);
  assert.match(jobs, /leaseUntil/);
  assert.match(jobs, /attemptedAt: \{ gte: startOfShanghaiDay/);
  assert.match(jobs, /retryPendingModelFaceRefunds/);
});

test('lookbook starts and polls a three-face background job without clearing existing faces', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');

  assert.match(source, /const handleGenerateFaces = \(\) => submitFaceJob\(\{ count: MODEL_FACE_BATCH_SIZE \}\)/);
  assert.match(source, /body: JSON\.stringify\(body\)/);
  assert.match(source, /const MODEL_FACE_BATCH_SIZE = 3/);
  assert.match(source, /MODEL_FACE_POLL_MAX_MS = 12_000/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /document\.visibilityState/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /localStorage\.setItem\(MODEL_FACE_JOB_STORAGE_KEY, data\.jobId\)/);
  assert.ok(
    source.indexOf('localStorage.setItem(MODEL_FACE_JOB_STORAGE_KEY, data.jobId)') < source.indexOf('await pollModelFaceJob(data.jobId)'),
    'POST 成功后必须先持久化 jobId，再发起首次轮询',
  );
  assert.match(source, /再出 3 张/);
  assert.match(source, /每张 ¥\{\(MODEL_FACE_PRICE_FEN \/ 100\)\.toFixed\(2\)\}/);
  assert.doesNotMatch(source, /setFaceCandidates\(\[\]\)/);
  assert.doesNotMatch(source, /for \(let specIndex/);
});

test('failed face jobs can be resumed when an item is still running', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');

  assert.match(
    source,
    /job\.items\.some\(item => \['pending', 'running'\]\.includes\(item\.status\)\)/,
  );
});

test('face image normalization finishes before the row-locking store transaction starts', () => {
  const source = fs.readFileSync('lib/model-face-jobs.ts', 'utf8');
  const prepareIndex = source.indexOf('prepareModelFaceImage(input.data)');
  const transactionIndex = source.indexOf('prisma.$transaction', prepareIndex);

  assert.ok(prepareIndex >= 0, 'runner must prepare the generated image before storage');
  assert.ok(transactionIndex > prepareIndex, 'CPU image encoding must finish before opening the store transaction');
  assert.match(source.slice(transactionIndex, transactionIndex + 1_200), /storePreparedModelFace/);
});
