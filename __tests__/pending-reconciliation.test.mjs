import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('admin has a read-only stale paid-delivery reconciliation API and page', () => {
  const route = fs.readFileSync('app/api/admin/pending-deliveries/route.ts', 'utf8');
  const page = fs.readFileSync('app/admin/pending-deliveries/page.tsx', 'utf8');
  const pending = fs.readFileSync('lib/pending-image.ts', 'utf8');

  assert.match(route, /user\?\.role !== 'admin'/);
  assert.match(route, /listStalePendingImages/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(pending, /kind: 'result', createdAt: \{ lt: cutoff \}/);
  assert.match(page, /已扣费未取走/);
  assert.match(page, /仅供人工对账，不会自动退款/);
});
