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

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pixelAt(raw, info, x, y) {
  const offset = (y * info.width + x) * info.channels;
  return [raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]];
}

async function pngFromPainter(width, height, painter) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = painter(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

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

test('harmonizeFaceTone pulls masked skin toward reference ring and feathers the edge', async () => {
  const width = 200;
  const height = 200;
  const ellipse = { cx: 100, cy: 100, rx: 40, ry: 50, width, height };
  const referenceSkin = [150, 100, 70];
  const targetSkin = [220, 170, 140];
  const outside = [150, 100, 70];

  const normalizedRadius = (x, y) => Math.sqrt(((x - ellipse.cx) / ellipse.rx) ** 2 + ((y - ellipse.cy) / ellipse.ry) ** 2);
  const pass1 = await pngFromPainter(width, height, (x, y) => {
    const radius = normalizedRadius(x, y);
    return radius >= 1.15 && radius <= 1.45 ? referenceSkin : [20, 40, 80];
  });
  const pass2 = await pngFromPainter(width, height, (x, y) => {
    const radius = normalizedRadius(x, y);
    return radius <= 1 ? targetSkin : outside;
  });

  assert.equal(typeof masks.harmonizeFaceTone, 'function');
  const harmonized = await masks.harmonizeFaceTone(pass1, pass2, ellipse);
  const { data, info } = await sharp(harmonized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const center = pixelAt(data, info, 100, 100);
  const outsideAfter = pixelAt(data, info, 100, 38);
  const innerEdge = pixelAt(data, info, 100, 52);
  const outerEdge = pixelAt(data, info, 100, 49);

  assert.ok(
    colorDistance(center, referenceSkin) < colorDistance(targetSkin, referenceSkin),
    `center ${center.slice(0, 3)} should move toward ${referenceSkin}`,
  );
  assert.deepEqual(outsideAfter.slice(0, 3), outside);
  assert.ok(
    colorDistance(innerEdge, outerEdge) < colorDistance(targetSkin, outside),
    `feathered boundary ${innerEdge.slice(0, 3)} -> ${outerEdge.slice(0, 3)} should reduce the original jump`,
  );
});
