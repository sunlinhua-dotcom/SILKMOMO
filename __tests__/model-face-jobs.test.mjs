import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const runner = await import('../lib/model-face-job-runner.ts');
const billing = await import('../lib/billing-constants.ts');

function fakeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      deduct: async () => { calls.push('deduct'); return { success: true }; },
      generate: async () => { calls.push('generate'); return { success: true, data: 'image-data', mimeType: 'image/png' }; },
      store: async () => { calls.push('store'); return { id: 'face-1' }; },
      refund: async () => { calls.push('refund'); return { success: true }; },
      ...overrides,
    },
  };
}

test('successful model face keeps the GPT Image 2 medium charge and persists immediately', async () => {
  const { calls, deps } = fakeDeps();
  const result = await runner.generateChargedModelFace({
    userId: 'u1', specIndex: 2, costFen: billing.getGenerationCostFen('openai', 'medium'),
  }, deps);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.faceId, 'face-1');
  assert.equal(result.costFen, 120);
  assert.deepEqual(calls, ['deduct', 'generate', 'store']);
});

test('failed model face is refunded and is never stored', async () => {
  const { calls, deps } = fakeDeps({
    generate: async () => { calls.push('generate'); return { success: false, error: 'timeout' }; },
  });
  const result = await runner.generateChargedModelFace({ userId: 'u1', specIndex: 0, costFen: 120 }, deps);

  assert.equal(result.status, 'failed');
  assert.deepEqual(calls, ['deduct', 'generate', 'refund']);
});

test('insufficient balance starts no generation and needs no refund', async () => {
  const { calls, deps } = fakeDeps({
    deduct: async () => { calls.push('deduct'); return { success: false, error: '余额不足' }; },
  });
  const result = await runner.generateChargedModelFace({ userId: 'u1', specIndex: 0, costFen: 120 }, deps);

  assert.equal(result.status, 'blocked');
  assert.deepEqual(calls, ['deduct']);
});

test('model face jobs persist per-item state and enforce one active job per account', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(schema, /model ModelFaceGenerationJob \{/);
  assert.match(schema, /model ModelFaceGenerationItem \{/);
  assert.match(schema, /activeKey\s+String\?\s+@unique/);
  assert.match(schema, /items\s+ModelFaceGenerationItem\[\]/);
  assert.match(schema, /status\s+String\s+@default\("pending"\)/);
});

test('job API recovers interrupted work and caps each UTC+8 day at 200 requested faces', () => {
  const route = fs.readFileSync('app/api/model-face/route.ts', 'utf8');
  const jobs = fs.readFileSync('lib/model-face-jobs.ts', 'utf8');

  assert.match(route, /export async function GET/);
  assert.match(route, /return NextResponse\.json\(\{ jobId: job\.id \}/);
  assert.match(jobs, /export const DAILY_MODEL_FACE_LIMIT = 200/);
  assert.match(jobs, /startOfShanghaiDay/);
  assert.match(jobs, /recoverInterruptedModelFaceJobs/);
  assert.match(jobs, /status: 'failed'/);
  assert.match(jobs, /服务进程已重启，可继续生成/);
});

test('lookbook starts and polls a three-face background job without clearing existing faces', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');

  assert.match(source, /const handleGenerateFaces = \(\) => submitFaceJob\(\{ count: MODEL_FACE_BATCH_SIZE \}\)/);
  assert.match(source, /body: JSON\.stringify\(body\)/);
  assert.match(source, /const MODEL_FACE_BATCH_SIZE = 3/);
  assert.match(source, /setInterval\([^]*pollModelFaceJob/);
  assert.match(source, /再出 3 张/);
  assert.match(source, /每张 ¥\{\(MODEL_FACE_PRICE_FEN \/ 100\)\.toFixed\(2\)\}/);
  assert.doesNotMatch(source, /setFaceCandidates\(\[\]\)/);
  assert.doesNotMatch(source, /for \(let specIndex/);
});
