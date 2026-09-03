import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('model face job states use Prisma enums and database check constraints', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const migrationDirs = fs.readdirSync('prisma/migrations', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const latest = migrationDirs.at(-1);
  const migration = fs.readFileSync(`prisma/migrations/${latest}/migration.sql`, 'utf8');

  assert.match(schema, /enum ModelFaceJobStatus/);
  assert.match(schema, /enum ModelFaceItemStatus/);
  assert.match(schema, /enum ModelFaceBillingStatus/);
  assert.match(schema, /status\s+ModelFaceJobStatus\s+@default\(queued\)/);
  assert.match(schema, /status\s+ModelFaceItemStatus\s+@default\(pending\)/);
  assert.match(schema, /idempotencyKey\s+String\?\s+@unique/);
  assert.match(migration, /CREATE TYPE "ModelFaceJobStatus" AS ENUM/);
  assert.match(migration, /ModelFaceGenerationJob_requestedCount_check/);
  assert.match(migration, /ModelFaceGenerationJob_costFen_check/);
  assert.match(migration, /ModelFaceGenerationItem_specIndex_check/);
  assert.match(migration, /ModelFaceGenerationItem_position_check/);
});
