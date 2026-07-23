import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import sharp from 'sharp';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sharpUrl = pathToFileURL(require.resolve('sharp')).href;

function transpileLocalModule(path, replacements = {}) {
  let source = fs.readFileSync(path, 'utf8');
  for (const [from, to] of Object.entries(replacements)) {
    source = source.split(from).join(to);
  }
  let output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  output = output.replace(/from ['"]sharp['"]/g, `from ${JSON.stringify(sharpUrl)}`);
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}

const normalizerUrl = transpileLocalModule('lib/reference-image-normalizer.ts');
const masks = await import(transpileLocalModule('lib/face-mask.ts', {
  "from './reference-image-normalizer'": `from '${normalizerUrl}'`,
}));

test('createFaceEditMask makes the visible face ellipse transparent and keeps outside opaque', async () => {
  const image = await sharp({
    create: {
      width: 1000,
      height: 800,
      channels: 3,
      background: { r: 20, g: 30, b: 40 },
    },
  }).jpeg().toBuffer();

  const normalized = await masks.normalizeImageForFacePass({
    data: image.toString('base64'),
    mimeType: 'image/jpeg',
  });
  const mask = await masks.createFaceEditMask(normalized, [375, 425, 625, 575]);
  const { data, info } = await sharp(Buffer.from(mask.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];

  assert.equal(mask.mimeType, 'image/png');
  assert.equal(info.width, normalized.width);
  assert.equal(info.height, normalized.height);
  assert.equal(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2)), 0);
  assert.equal(alphaAt(0, 0), 255);
});

test('isUsableFaceRegion rejects tiny and hidden face regions', async () => {
  assert.equal(masks.isUsableFaceRegion(null), false);
  assert.equal(masks.isUsableFaceRegion({ visibility: 'heavy', visibleFaceBox2d: [100, 100, 500, 500] }), false);
  assert.equal(masks.isUsableFaceRegion({ visibility: 'clear', visibleFaceBox2d: [100, 100, 120, 120] }), false);
  assert.equal(masks.isUsableFaceRegion({ visibility: 'partial', visibleFaceBox2d: [200, 300, 550, 700] }), true);
});

test('createFaceEditMask excludes upper face when eyewear occludes the eyes', async () => {
  const mask = await masks.createFaceEditMask(
    { width: 1000, height: 1000 },
    [200, 300, 800, 700],
    ['sunglasses'],
  );
  const { data, info } = await sharp(Buffer.from(mask.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];

  assert.equal(alphaAt(500, 440), 255);
  assert.equal(alphaAt(500, 680), 0);
});
