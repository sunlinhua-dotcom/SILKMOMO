import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const delivery = await import('../lib/pending-delivery-core.ts').catch(() => ({}));
const pendingFetch = await import('../lib/pending-fetch.ts').catch(() => ({}));

test('a slow paid image body is not aborted by the 10ms handshake timeout', async () => {
  assert.equal(typeof pendingFetch.fetchPendingImageWithRetry, 'function');
  let signal;
  const result = await pendingFetch.fetchPendingImageWithRetry('slow-image', {
    attempts: 1,
    handshakeTimeoutMs: 10,
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return {
        status: 200,
        ok: true,
        json: async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return { image: { data: 'large-image', mimeType: 'image/png', width: 2048, height: 2731 } };
        },
      };
    },
  });

  assert.equal(signal.aborted, false);
  assert.deepEqual(result, { data: 'large-image', mimeType: 'image/png', width: 2048, height: 2731 });
});

test('result and anchor deliveries use a pending id and never inline data after a successful store', async () => {
  assert.equal(typeof delivery.preparePendingDelivery, 'function');
  const stored = [];
  const store = async (input) => {
    stored.push(input);
    return `pending-${input.kind}`;
  };

  const result = await delivery.preparePendingDelivery(store, {
    kind: 'result', userId: 'u1', taskId: 7, shotIndex: 2, data: 'result-data', mimeType: 'image/png', width: 100, height: 200,
  });
  const anchor = await delivery.preparePendingDelivery(store, {
    kind: 'anchor', userId: 'u1', taskId: 7, shotIndex: 0, data: 'anchor-data', mimeType: 'image/jpeg', width: 0, height: 0,
  });

  assert.deepEqual(result.payload, { pendingId: 'pending-result' });
  assert.deepEqual(anchor.payload, { pendingId: 'pending-anchor' });
  assert.equal('imageData' in result.payload, false);
  assert.equal('imageData' in anchor.payload, false);
  assert.deepEqual(stored.map((item) => item.kind), ['result', 'anchor']);
});

test('pending store failure keeps the existing fail-open inline delivery', async () => {
  const prepared = await delivery.preparePendingDelivery(async () => null, {
    kind: 'anchor', userId: 'u1', taskId: 7, shotIndex: 0, data: 'anchor-data', mimeType: 'image/jpeg', width: 0, height: 0,
  });
  assert.deepEqual(prepared.payload, { imageData: 'anchor-data', mimeType: 'image/jpeg' });
});

test('page recovery distinguishes pending anchors from paid results and persists both', () => {
  const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');
  const pendingSource = fs.readFileSync('lib/pending-image.ts', 'utf8');
  assert.match(pendingSource, /select: \{ id: true, kind: true, shotIndex: true/);
  assert.match(taskSource, /if \(meta\.kind === 'anchor'\)/);
  assert.match(taskSource, /type: 'anchor'/);
});
