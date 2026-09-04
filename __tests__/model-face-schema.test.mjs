import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('model face job states use Prisma enums and database check constraints', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const migrationDirs = fs.readdirSync('prisma/migrations', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const migrations = migrationDirs
    .map(dir => fs.readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8'))
    .join('\n');

  assert.match(schema, /enum ModelFaceJobStatus/);
  assert.match(schema, /enum ModelFaceItemStatus/);
  assert.match(schema, /enum ModelFaceBillingStatus/);
  assert.match(schema, /status\s+ModelFaceJobStatus\s+@default\(queued\)/);
  assert.match(schema, /status\s+ModelFaceItemStatus\s+@default\(pending\)/);
  assert.match(schema, /idempotencyKey\s+String\?\s+@unique/);
  assert.match(schema, /@@index\(\[billingStatus\]\)/);
  assert.match(migrations, /CREATE TYPE "ModelFaceJobStatus" AS ENUM/);
  assert.match(migrations, /ModelFaceGenerationJob_requestedCount_check/);
  assert.match(migrations, /ModelFaceGenerationJob_costFen_check/);
  assert.match(migrations, /ModelFaceGenerationItem_specIndex_check/);
  assert.match(migrations, /ModelFaceGenerationItem_position_check/);
  assert.match(migrations, /CREATE INDEX "ModelFaceGenerationItem_billingStatus_idx"/);
});
