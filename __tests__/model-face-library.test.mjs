import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';

const libraryModule = await import('../lib/model-face-image.ts').catch(() => ({}));

test('model faces are durable account-owned records with required metadata', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

  assert.match(schema, /model ModelFace \{/);
  for (const field of ['id', 'userId', 'image', 'thumbnail', 'specIndex', 'recipeLabel', 'createdAt', 'favorite', 'name']) {
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
  assert.match(route, /listModelFaces\(auth\.userId,/);
  assert.match(library, /const where = \{ userId \}/);
  assert.match(library, /orderBy: \[\{ favorite: 'desc' \}, \{ createdAt: 'desc' \}\]/);
  assert.match(library, /take: safePageSize/);
  assert.match(library, /skip: \(safePage - 1\) \* safePageSize/);
  const listSelectStart = library.indexOf('MODEL_FACE_LIST_SELECT');
  const listSelectEnd = library.indexOf('} as const;', listSelectStart);
  const listSelect = library.slice(listSelectStart, listSelectEnd);
  assert.match(listSelect, /thumbnail: true/);
  assert.doesNotMatch(listSelect, /\bimage: true/);
  assert.match(route, /searchParams\.get\('page'\)/);
  assert.match(route, /MODEL_FACE_PAGE_SIZE/);
});

test('model face mutations are owner-scoped and support favorite name and delete', () => {
  const route = fs.readFileSync('app/api/model-faces/[id]/route.ts', 'utf8');

  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /favorite/);
  assert.match(route, /name/);
  assert.match(route, /where: \{ id, userId: auth\.userId \}/g);
  assert.doesNotMatch(route, /delete\(\{\s*where: \{ id \}/);
});

test('model face images are normalized to quality-88 JPEG with a 256px thumbnail', async () => {
  assert.equal(typeof libraryModule.prepareModelFaceImage, 'function');
  const png = await sharp({
    create: { width: 800, height: 1000, channels: 3, background: '#c9a86c' },
  }).png().toBuffer();
  const normalized = await libraryModule.prepareModelFaceImage(png.toString('base64'));
  const originalMeta = await sharp(Buffer.from(normalized.image, 'base64')).metadata();
  const thumbnailMeta = await sharp(Buffer.from(normalized.thumbnail, 'base64')).metadata();

  assert.equal(normalized.mimeType, 'image/jpeg');
  assert.equal(originalMeta.format, 'jpeg');
  assert.equal(thumbnailMeta.format, 'jpeg');
  assert.equal(thumbnailMeta.width, 256);
  assert.ok((thumbnailMeta.height || 0) > 0);

  const library = fs.readFileSync('lib/model-face-library.ts', 'utf8');
  const imageHelper = fs.readFileSync('lib/model-face-image.ts', 'utf8');
  assert.match(library, /export const MODEL_FACE_LIBRARY_LIMIT = 200/);
  assert.match(library, /storedFaces >= MODEL_FACE_LIBRARY_LIMIT/);
  assert.match(imageHelper, /\.jpeg\(\{ quality: MODEL_FACE_JPEG_QUALITY \}\)/);
  assert.match(imageHelper, /resize\(\{ width: MODEL_FACE_THUMBNAIL_WIDTH/);
  assert.match(library, /thumbnail: normalized\.thumbnail/);
  assert.doesNotMatch(library, /MAX_.*FACE|slice\(/);
});
