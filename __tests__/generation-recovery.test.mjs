import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const recovery = await import('../lib/generation-recovery.ts').catch(() => ({}));
const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

function sourceBetween(start, end) {
  const startIndex = taskSource.indexOf(start);
  const endIndex = taskSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return taskSource.slice(startIndex, endIndex);
}

test('stall gap is non-fatal, later chunks continue, and final auto-fill is scheduled', () => {
  assert.equal(typeof recovery.reconcileStalledChunk, 'function');
  const stalled = recovery.reconcileStalledChunk({
    successfulShots: new Set([1]),
    recoveredShotIndexes: [],
    expectedShots: [1, 2, 3, 4],
    stalledChunkShots: [2],
  });

  assert.equal(stalled.fatal, false);
  assert.equal(stalled.continueChunks, true);
  assert.deepEqual(stalled.unresolvedChunkShots, [2]);

  const afterLaterChunks = recovery.mergeRecoveredShots(
    stalled.successfulShots,
    [3, 4],
    [1, 2, 3, 4],
  );
  const outcome = recovery.finalizeGeneration({
    expectedShots: [1, 2, 3, 4],
    successfulShots: afterLaterChunks,
    lastError: '连接中断',
    lastErrorWasStall: true,
  });
  assert.deepEqual(outcome.remaining, [2]);
  assert.equal(recovery.shouldScheduleAutomaticFill({
    remaining: outcome.remaining,
    lastErrorWasStall: true,
    fatalStop: false,
    alreadyRetried: false,
  }), true);
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

test('all four paid retry entry points recover pending images before mutating or sending work', () => {
  const remaining = sourceBetween('const handleGenerateRemaining', '// ═══════════');
  const failedShot = sourceBetween('const handleRetryFailedShot', '// ─── 取消生成');
  const newParams = sourceBetween('const handleRegenerateWithNewParams', 'const handleRegenerate =');
  const regenerate = sourceBetween('const handleRegenerate =', 'const handleAcceptNewVersion');

  assert.ok(remaining.indexOf('recoverPendingImages(taskId)') < remaining.indexOf('missingShotIndexes('));
  assert.ok(failedShot.indexOf('recoverPendingImages(taskId, [shotIndex])') < failedShot.indexOf('handleStartGeneration('));
  assert.ok(newParams.indexOf('recoverPendingImages(taskId)') < newParams.indexOf("type === 'result_backup'"));
  assert.ok(regenerate.indexOf('recoverPendingImages(taskId)') < regenerate.indexOf("type: 'result_backup'"));
});

test('the whole-task retry button routes through remaining-work recovery', () => {
  assert.match(taskSource, /onClick=\{\(\) => void handleGenerateRemaining\(\)\}[\s\S]*?>\s*\u91cd\u8bd5\s*</);
});

test('one run id is forwarded from paid retry entry points into the generation request', () => {
  assert.match(taskSource, /const handleGenerateRemaining[\s\S]*?const runId = existingRunId \|\| crypto\.randomUUID\(\)[\s\S]*?handleStartGeneration\([\s\S]*?\{ runId, recoveryChecked: true \}/);
  assert.match(taskSource, /const handleRetryFailedShot[\s\S]*?const runId = crypto\.randomUUID\(\)[\s\S]*?handleStartGeneration\([\s\S]*?\{ runId, recoveryChecked: true \}/);
  assert.match(taskSource, /const handleRegenerateWithNewParams[\s\S]*?const runId = crypto\.randomUUID\(\)[\s\S]*?handleStartGeneration\([\s\S]*?\{ runId, recoveryChecked: true \}/);
  assert.match(taskSource, /const handleRegenerate = async[\s\S]*?const runId = crypto\.randomUUID\(\)[\s\S]*?handleStartGeneration\([\s\S]*?\{ runId, recoveryChecked: true \}/);
  assert.match(taskSource, /fetch\('\/api\/generate\/stream'[\s\S]*?body: JSON\.stringify\(\{[\s\S]*?runId,/);
});

test('a restored backup is visible but does not make a failed redo completed', () => {
  assert.equal(typeof recovery.mergeRunLocalResults, 'function');
  const successfulShots = recovery.mergeRunLocalResults({
    successfulShots: new Set(),
    localShotIndexes: [2],
    expectedShots: [2],
    restoredShotIndexes: new Set([2]),
  });
  const outcome = recovery.finalizeGeneration({
    expectedShots: [2],
    successfulShots,
    lastError: '上游生成失败（已自动退款）',
    lastErrorWasStall: false,
  });

  assert.deepEqual([...successfulShots], []);
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(outcome.remaining, [2]);
});
