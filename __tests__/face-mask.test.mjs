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

test('createFaceEditMask subtracts an exact eyewear rectangle while keeping the profile nose editable', async () => {
  const mask = await masks.createFaceEditMask(
    { width: 200, height: 200 },
    [200, 200, 800, 800],
    {
      occluders: ['sunglasses'],
      eyewearBox2d: [400, 350, 550, 650],
      faceBox2d: [200, 200, 800, 800],
      headPose: 'profile',
    },
  );
  const { data, info } = await sharp(Buffer.from(mask.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];

  assert.ok(mask.geometry.occluderRects.some(rect => rect.label === 'eyewear'));
  assert.equal(alphaAt(100, 95), 255, 'eyewear center must remain protected');
  assert.equal(alphaAt(65, 120), 0, 'profile nose area outside eyewear must remain editable');
});

test('createFaceEditMask clamps the ellipse to faceBox2d', async () => {
  const mask = await masks.createFaceEditMask(
    { width: 200, height: 200 },
    [100, 100, 900, 900],
    {
      faceBox2d: [250, 250, 750, 750],
      headPose: 'profile',
    },
  );
  const { data, info } = await sharp(Buffer.from(mask.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];

  assert.deepEqual(mask.geometry.faceRect, { left: 50, top: 50, right: 150, bottom: 150 });
  assert.equal(alphaAt(35, 100), 255, 'ellipse pixels outside faceBox must stay protected');
  assert.equal(alphaAt(100, 100), 0, 'ellipse pixels inside faceBox remain editable');
});

test('createFaceEditMask protects a generic hat-brim occluder box', async () => {
  const mask = await masks.createFaceEditMask(
    { width: 200, height: 200 },
    [100, 100, 900, 900],
    {
      faceBox2d: [100, 100, 900, 900],
      occluderBoxes2d: [
        { label: 'hat brim', box2d: [300, 200, 450, 800] },
      ],
    },
  );
  const { data, info } = await sharp(Buffer.from(mask.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];

  assert.ok(mask.geometry.occluderRects.some(rect => rect.label === 'hat brim'));
  assert.equal(alphaAt(100, 75), 255, 'hat brim must stay protected');
  assert.equal(alphaAt(100, 120), 0, 'visible cheek below the brim remains editable');
});

test('createFaceEditMask falls back to the legacy lower-face crop when eyewear bbox is missing', async () => {
  const mask = await masks.createFaceEditMask(
    { width: 1000, height: 1000 },
    [200, 300, 800, 700],
    {
      occluders: ['sunglasses'],
      eyewearBox2d: null,
      faceBox2d: [200, 300, 800, 700],
      headPose: 'profile',
    },
  );
  const { data, info } = await sharp(Buffer.from(mask.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];

  assert.equal(mask.geometry.occluderRects.length, 0);
  assert.equal(alphaAt(500, 440), 255);
  assert.equal(alphaAt(500, 680), 0);
});

test('profile ellipse preserves the bbox aspect ratio and adds silhouette safety margin', async () => {
  const frontal = await masks.createFaceEditMask(
    { width: 1000, height: 1000 },
    [100, 400, 900, 600],
    { headPose: 'frontal' },
  );
  const profile = await masks.createFaceEditMask(
    { width: 1000, height: 1000 },
    [100, 400, 900, 600],
    { headPose: 'profile' },
  );

  assert.ok(profile.geometry.ellipse.rx < profile.geometry.ellipse.ry / 2);
  assert.ok(profile.geometry.ellipse.rx > frontal.geometry.ellipse.rx);
  assert.ok(profile.geometry.ellipse.ry > frontal.geometry.ellipse.ry);
});

test('harmonizeFaceTone pulls editable skin toward reference, skips eyewear, and feathers the edge', async () => {
  const width = 200;
  const height = 200;
  const ellipse = { cx: 100, cy: 100, rx: 40, ry: 50, width, height };
  const geometry = {
    ellipse,
    faceRect: { left: 0, top: 0, right: width, bottom: height },
    occluderRects: [
      { label: 'hat brim', left: 92, top: 94, right: 108, bottom: 106 },
    ],
  };
  const referenceSkin = [150, 100, 70];
  const targetSkin = [220, 170, 140];
  const highlight = [235, 230, 225];
  const darkOccluder = [25, 25, 28];
  const eyewearColor = [245, 210, 180];
  const outside = [150, 100, 70];

  const normalizedRadius = (x, y) => Math.sqrt(((x - ellipse.cx) / ellipse.rx) ** 2 + ((y - ellipse.cy) / ellipse.ry) ** 2);
  const pass1 = await pngFromPainter(width, height, (x, y) => {
    const radius = normalizedRadius(x, y);
    return radius >= 1.15 && radius <= 1.45 ? referenceSkin : [20, 40, 80];
  });
  const pass2 = await pngFromPainter(width, height, (x, y) => {
    const radius = normalizedRadius(x, y);
    const occluder = geometry.occluderRects[0];
    if (x >= occluder.left && x < occluder.right
      && y >= occluder.top && y < occluder.bottom) return eyewearColor;
    if (x === 100 && y === 90) return highlight;
    if (x === 100 && y === 110) return darkOccluder;
    return radius <= 1 ? targetSkin : outside;
  });

  assert.equal(typeof masks.harmonizeFaceTone, 'function');
  const harmonized = await masks.harmonizeFaceTone(pass1, pass2, geometry);
  const { data, info } = await sharp(harmonized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const center = pixelAt(data, info, 100, 120);
  const eyewearAfter = pixelAt(data, info, 100, 100);
  const highlightAfter = pixelAt(data, info, 100, 90);
  const darkAfter = pixelAt(data, info, 100, 110);
  const outsideAfter = pixelAt(data, info, 100, 38);
  const innerEdge = pixelAt(data, info, 100, 52);
  const outerEdge = pixelAt(data, info, 100, 49);

  assert.ok(
    colorDistance(center, referenceSkin) < colorDistance(targetSkin, referenceSkin),
    `center ${center.slice(0, 3)} should move toward ${referenceSkin}`,
  );
  assert.deepEqual(eyewearAfter.slice(0, 3), eyewearColor);
  assert.ok(
    colorDistance(highlightAfter, referenceSkin) < colorDistance(highlight, referenceSkin) * 0.75,
    `highlight ${highlightAfter.slice(0, 3)} should also move toward ${referenceSkin}`,
  );
  assert.ok(
    colorDistance(darkAfter, darkOccluder) < 8,
    `dark occluder ${darkAfter.slice(0, 3)} should stay close to ${darkOccluder}`,
  );
  assert.deepEqual(outsideAfter.slice(0, 3), outside);
  assert.ok(
    colorDistance(innerEdge, outerEdge) < colorDistance(targetSkin, outside),
    `feathered boundary ${innerEdge.slice(0, 3)} -> ${outerEdge.slice(0, 3)} should reduce the original jump`,
  );
});

test('compositeFaceRegion takes swap pixels inside ellipse, feathers boundary, and preserves outside pass1', async () => {
  const width = 80;
  const height = 80;
  const ellipse = { cx: 40, cy: 40, rx: 20, ry: 20, width, height };
  const geometry = {
    ellipse,
    faceRect: { left: 20, top: 20, right: 60, bottom: 60 },
    occluderRects: [
      { label: 'sunglasses', left: 32, top: 34, right: 48, bottom: 42 },
    ],
  };
  const pass1Color = [40, 50, 60];
  const swapColor = [210, 80, 30];

  const pass1 = await pngFromPainter(width, height, () => pass1Color);
  const smallerSwap = await pngFromPainter(40, 40, () => swapColor);

  assert.equal(typeof masks.compositeFaceRegion, 'function');
  const composited = await masks.compositeFaceRegion(pass1, smallerSwap, geometry);
  const { data, info } = await sharp(composited).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const protectedEyewear = pixelAt(data, info, 40, 38);
  const editableFace = pixelAt(data, info, 40, 48);
  const outside = pixelAt(data, info, 8, 8);
  const edge = pixelAt(data, info, 59, 40);

  assert.deepEqual(outside.slice(0, 3), pass1Color);
  assert.deepEqual(protectedEyewear.slice(0, 3), pass1Color);
  assert.ok(colorDistance(editableFace, swapColor) < 2, `editable face ${editableFace.slice(0, 3)} should be swap-colored`);
  assert.ok(colorDistance(edge, pass1Color) > 1, `edge ${edge.slice(0, 3)} should include some swap color`);
  assert.ok(colorDistance(edge, swapColor) > 1, `edge ${edge.slice(0, 3)} should be feathered, not full swap`);
});

test('compositeFaceRegion uses a continuous YCbCr skin weight with a nonzero floor', async () => {
  const width = 120;
  const height = 120;
  const ellipse = { cx: 60, cy: 60, rx: 50, ry: 50, width, height };
  const geometry = {
    ellipse,
    faceRect: { left: 5, top: 5, right: 115, bottom: 115 },
    occluderRects: [],
  };
  const delta = [30, 20, -20];
  const colors = {
    skin: [180, 120, 90],
    transition: [145, 135, 145],
    sky: [80, 150, 210],
  };
  const baseColorAt = x => (x < 50 ? colors.skin : x < 80 ? colors.transition : colors.sky);
  const pass1 = await pngFromPainter(width, height, x => baseColorAt(x));
  const swap = await pngFromPainter(width, height, x => {
    const base = baseColorAt(x);
    return [base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]];
  });

  const composited = await masks.compositeFaceRegion(pass1, swap, geometry);
  const { data, info } = await sharp(composited).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const effectiveAlpha = (x, base) => (pixelAt(data, info, x, 60)[0] - base[0]) / delta[0];
  const skinAlpha = effectiveAlpha(30, colors.skin);
  const transitionAlpha = effectiveAlpha(65, colors.transition);
  const skyAlpha = effectiveAlpha(90, colors.sky);

  assert.ok(skinAlpha > 0.9, `skin alpha ${skinAlpha} should stay strong`);
  assert.ok(transitionAlpha < skinAlpha && transitionAlpha > skyAlpha, `weights should transition smoothly: ${skinAlpha}, ${transitionAlpha}, ${skyAlpha}`);
  assert.ok(skyAlpha >= 0.1 && skyAlpha < 0.3, `non-skin alpha ${skyAlpha} must decay without becoming a hole`);
});
