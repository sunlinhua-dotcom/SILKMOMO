import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const recovery = await import('../lib/generation-recovery.ts').catch(() => ({}));

test('stall recovery counts only newly recovered requested shots before choosing the next chunk', () => {
  assert.equal(typeof recovery.mergeRecoveredShots, 'function');
  const merged = recovery.mergeRecoveredShots(new Set([1]), [1, 2, 8], [1, 2, 3]);
  assert.deepEqual([...merged].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(recovery.missingShotIndexes([1, 2, 3], merged), [3]);
});

test('final status and error are derived after pending recovery from actual output', () => {
  assert.equal(typeof recovery.finalizeGeneration, 'function');
  assert.deepEqual(recovery.finalizeGeneration({
    expectedShots: [1, 2],
    successfulShots: new Set([1, 2]),
    lastError: '连接中断',
    lastErrorWasStall: true,
  }), {
    status: 'completed',
    remaining: [],
    lastError: undefined,
  });
});

test('paid generation is blocked with an explicit message when bounded recovery fails', () => {
  assert.equal(recovery.PAID_IMAGE_RECOVERY_ERROR, '有已付费的图未取回，请刷新后再试');
  assert.deepEqual(recovery.recoveryGate({ ok: false, recoveredShotIndexes: [] }), {
    proceed: false,
    message: recovery.PAID_IMAGE_RECOVERY_ERROR,
  });
  assert.deepEqual(recovery.recoveryGate({ ok: true, recoveredShotIndexes: [2] }), {
    proceed: true,
    recoveredShotIndexes: [2],
  });
});

test('all paid retry entry points recover before calculating or sending work', () => {
  const page = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');
  assert.match(page, /const handleGenerateRemaining[\s\S]*?recoveryGate\(await recoverPendingImages\(taskId\)\)[\s\S]*?missingShotIndexes/);
  assert.match(page, /const handleRetryFailedShot[\s\S]*?recoverPendingImages\(taskId, \[shotIndex\]\)[\s\S]*?handleStartGeneration/);
  assert.match(page, /onClick=\{\(\) => void handleGenerateRemaining\(\)\}[\s\S]*?>\s*重试\s*</);
  assert.match(page, /if \(!opts\?\.recoveryChecked\)[\s\S]*?recoverPendingImages\(taskId\)[\s\S]*?fetch\('\/api\/generate\/stream'/);
});
