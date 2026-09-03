import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('model faces are durable account-owned records with required metadata', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

  assert.match(schema, /model ModelFace \{/);
  for (const field of ['id', 'userId', 'image', 'specIndex', 'recipeLabel', 'createdAt', 'favorite', 'name']) {
    assert.match(schema, new RegExp(`\\b${field}\\s+`), `ModelFace 缺少 ${field}`);
  }
  assert.match(schema, /modelFaces\s+ModelFace\[\]/);
  assert.match(schema, /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
});

test('model face list is owner-scoped and sorts favorites before newest faces', () => {
  const route = fs.readFileSync('app/api/model-faces/route.ts', 'utf8');
  const library = fs.readFileSync('lib/model-face-library.ts', 'utf8');

  assert.match(route, /export async function GET/);
  assert.match(route, /getCurrentUser\(\)/);
  assert.match(route, /listModelFaces\(auth\.userId\)/);
  assert.match(library, /where: \{ userId \}/);
  assert.match(library, /orderBy: \[\{ favorite: 'desc' \}, \{ createdAt: 'desc' \}\]/);
  assert.match(library, /select: MODEL_FACE_PUBLIC_SELECT/);
});

test('model face mutations are owner-scoped and support favorite name and delete', () => {
  const route = fs.readFileSync('app/api/model-faces/[id]/route.ts', 'utf8');

  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /favorite/);
  assert.match(route, /name/);
  assert.match(route, /where: \{ id, userId: auth\.userId \}/g);
  assert.doesNotMatch(route, /delete\(\{\s*where: \{ id \}/);
});

test('model face images stay in the existing database storage boundary', () => {
  const library = fs.readFileSync('lib/model-face-library.ts', 'utf8');

  assert.match(library, /image: input\.image/);
  assert.match(library, /mimeType: input\.mimeType/);
  assert.doesNotMatch(library, /MAX_.*FACE|slice\(/);
});
