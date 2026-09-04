import assert from 'node:assert/strict';
import test from 'node:test';

const backpressure = await import('../lib/sse-backpressure.ts').catch(() => ({}));

test('negative desiredSize is logged once only after it persists for 30 seconds', () => {
  assert.equal(typeof backpressure.createSseBackpressureObserver, 'function');
  let now = 1;
  const logs = [];
  const observe = backpressure.createSseBackpressureObserver({
    thresholdMs: 30_000,
    now: () => now,
    log: data => logs.push(data),
  });

  observe(-1);
  now = 30_000;
  observe(-2);
  assert.equal(logs.length, 0);
  now = 30_001;
  observe(-2);
  observe(-3);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].desiredSize, -2);

  observe(0);
  now = 60_002;
  observe(-1);
  now = 90_002;
  observe(-1);
  assert.equal(logs.length, 2);
});
