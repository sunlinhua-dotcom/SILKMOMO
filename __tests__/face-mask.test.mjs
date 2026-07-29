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
    [300, 300, 700, 700],
    {
      faceBox2d: [250, 250, 750, 750],
      headPose: 'profile',
    },
  );
  const { data, info } = await sharp(Buffer.from(mask.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];

  assert.deepEqual(mask.geometry.faceRect, { left: 42, top: 42, right: 158, bottom: 158 });
  assert.equal(alphaAt(39, 100), 255, 'ellipse pixels outside expanded faceBox must stay protected');
  assert.equal(alphaAt(55, 100), 0, 'ellipse pixels inside expanded faceBox remain editable');
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

test('buildFaceAlphaField has no axis-aligned hard edge for frontal or profile geometry', async () => {
  const width = 300;
  const height = 300;
  for (const headPose of ['frontal', 'profile']) {
    const mask = await masks.createFaceEditMask(
      { width, height },
      [150, 150, 850, 850],
      {
        faceBox2d: [150, 150, 850, 850],
        headPose,
      },
    );
    const alpha = await masks.buildFaceAlphaField(mask.geometry, width, height);
    const { faceRect } = mask.geometry;
    const midX = Math.floor((faceRect.left + faceRect.right) / 2);
    const midY = Math.floor((faceRect.top + faceRect.bottom) / 2);
    const samples = [
      Array.from({ length: 31 }, (_, i) => alpha[(Math.floor(faceRect.top) - 15 + i) * width + midX]),
      Array.from({ length: 31 }, (_, i) => alpha[(Math.floor(faceRect.bottom) - 15 + i) * width + midX]),
      Array.from({ length: 31 }, (_, i) => alpha[midY * width + Math.floor(faceRect.left) - 15 + i]),
      Array.from({ length: 31 }, (_, i) => alpha[midY * width + Math.floor(faceRect.right) - 15 + i]),
    ];
    const maxAdjacentDelta = Math.max(...samples.flatMap(line => (
      line.slice(1).map((value, index) => Math.abs(value - line[index]))
    )));
    assert.ok(maxAdjacentDelta < 0.06, `${headPose} faceRect max adjacent alpha delta ${maxAdjacentDelta}`);
  }
});

test('buildFaceAlphaField profile faceRect no longer cuts the ellipse', async () => {
  const width = 240;
  const height = 240;
  const mask = await masks.createFaceEditMask(
    { width, height },
    [150, 200, 850, 800],
    {
      faceBox2d: [150, 200, 850, 800],
      headPose: 'profile',
    },
  );
  const clipped = await masks.buildFaceAlphaField(mask.geometry, width, height);
  const unclipped = await masks.buildFaceAlphaField({
    ...mask.geometry,
    faceRect: { left: 0, top: 0, right: width, bottom: height },
  }, width, height);
  const { ellipse } = mask.geometry;
  const probeX = Math.floor(ellipse.cx + ellipse.rx * 0.9259);
  const probeY = Math.floor(ellipse.cy);
  const offset = probeY * width + probeX;
  assert.ok(
    Math.abs(clipped[offset] - unclipped[offset]) < 0.05,
    `profile faceRect changed alpha ${unclipped[offset]} -> ${clipped[offset]}`,
  );
});

test('buildFaceAlphaField keeps original occluder boundary near zero', async () => {
  const width = 240;
  const height = 240;
  const geometry = {
    ellipse: { cx: 120, cy: 120, rx: 85, ry: 95, width, height },
    faceRect: { left: 25, top: 15, right: 215, bottom: 225 },
    occluderRects: [
      { label: 'sunglasses', left: 80, top: 90, right: 160, bottom: 118 },
    ],
  };
  const alpha = await masks.buildFaceAlphaField(geometry, width, height);
  const alphaAt = (x, y) => alpha[y * width + x];
  assert.ok(alphaAt(80, 104) < 0.10, `occluder boundary alpha ${alphaAt(80, 104)}`);
  assert.ok(alphaAt(120, 104) < 0.01, `occluder center alpha ${alphaAt(120, 104)}`);
});

test('buildFaceAlphaField keeps a real small-face alpha gradient below 0.06', async () => {
  const width = 1080;
  const height = 1440;
  const geometry = {
    ellipse: {
      cx: 558.36,
      cy: 304.56,
      rx: 87.48,
      ry: 36.5472,
      width,
      height,
    },
    faceRect: {
      left: 470.88,
      top: 185.6448,
      right: 645.84,
      bottom: 344.2752,
    },
    occluderRects: [],
  };
  const alpha = await masks.buildFaceAlphaField(geometry, width, height);
  const y = Math.floor(geometry.ellipse.cy);
  const boundary = Math.floor(geometry.faceRect.right);
  let maxDelta = 0;
  for (let x = boundary - 12; x <= boundary + 12; x++) {
    maxDelta = Math.max(maxDelta, Math.abs(alpha[y * width + x] - alpha[y * width + x - 1]));
  }
  assert.ok(maxDelta < 0.06, `small-face max alpha delta ${maxDelta}`);
});

test('alignSwapTone remains bounded while correcting a large tone mismatch', async () => {
  const width = 200;
  const height = 200;
  const ellipse = { cx: 100, cy: 100, rx: 40, ry: 50, width, height };
  const geometry = {
    ellipse,
    faceRect: { left: 0, top: 0, right: width, bottom: height },
    occluderRects: [],
  };
  const referenceSkin = [150, 100, 70];
  const targetSkin = [220, 170, 140];
  const pass1 = await pngFromPainter(width, height, () => referenceSkin);
  const swap = await pngFromPainter(width, height, () => targetSkin);

  const aligned = await masks.alignSwapTone(pass1, swap, geometry);
  const { data, info } = await sharp(aligned).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const center = pixelAt(data, info, 100, 100).slice(0, 3);

  assert.ok(colorDistance(center, referenceSkin) < colorDistance(targetSkin, referenceSkin));
  center.forEach((value, channel) => {
    assert.ok(
      Math.abs(value - targetSkin[channel]) <= 20,
      `channel ${channel} moved ${targetSkin[channel]} -> ${value}`,
    );
  });
});

test('collectSkinStatsRobust rejects dark brown hair from the face reference', async () => {
  const width = 200;
  const height = 200;
  const geometry = {
    ellipse: { cx: 100, cy: 100, rx: 60, ry: 70, width, height },
    faceRect: { left: 35, top: 25, right: 165, bottom: 175 },
    occluderRects: [],
  };
  const skin = [150, 100, 70];
  const hair = [60, 45, 40];
  const pass1 = await pngFromPainter(width, height, (x, y) => {
    const radius = Math.sqrt(((x + 0.5 - 100) / 60) ** 2 + ((y + 0.5 - 100) / 70) ** 2);
    if (radius <= 0.92 && x < 76) return hair;
    return skin;
  });
  const raw = await sharp(pass1).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const stats = masks.collectSkinStatsRobust(
    { data: raw.data, width: raw.info.width, height: raw.info.height, channels: 4 },
    geometry,
    radius => radius <= 0.92,
    true,
  );

  assert.ok(stats.count > 500);
  assert.ok(stats.medY > 100, `median Y ${stats.medY} should remain in skin cluster`);
  assert.ok(stats.rejectedByLuma > 0, 'dark hair should be rejected by the luma gate');
});

test('alignSwapTone preserves hue for a luminance-only mismatch', async () => {
  const width = 200;
  const height = 200;
  const geometry = {
    ellipse: { cx: 100, cy: 100, rx: 50, ry: 60, width, height },
    faceRect: { left: 45, top: 35, right: 155, bottom: 165 },
    occluderRects: [],
  };
  const referenceSkin = [150, 100, 70];
  const targetSkin = [220, 170, 140];
  const pass1 = await pngFromPainter(width, height, () => referenceSkin);
  const swap = await pngFromPainter(width, height, () => targetSkin);
  const aligned = await masks.alignSwapTone(pass1, swap, geometry);
  const { data, info } = await sharp(aligned).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = pixelAt(data, info, 100, 100).slice(0, 3);
  const chromaAngle = ([r, g, b]) => {
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return Math.atan2(cr - 128, cb - 128) * 180 / Math.PI;
  };

  assert.ok(Math.abs(chromaAngle(output) - chromaAngle(targetSkin)) < 3);
});

test('collectSkinStatsRobust median resists 40 percent hair contamination', async () => {
  const width = 100;
  const height = 100;
  const geometry = {
    ellipse: { cx: 50, cy: 50, rx: 50, ry: 50, width, height },
    faceRect: { left: 0, top: 0, right: width, bottom: height },
    occluderRects: [],
  };
  const skin = [160, 110, 80];
  const hair = [60, 45, 40];
  const image = await pngFromPainter(width, height, x => (x < 40 ? hair : skin));
  const raw = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const stats = masks.collectSkinStatsRobust(
    { data: raw.data, width: raw.info.width, height: raw.info.height, channels: 4 },
    geometry,
    () => true,
    true,
  );
  const expectedY = 0.299 * skin[0] + 0.587 * skin[1] + 0.114 * skin[2];

  assert.ok(Math.abs(stats.medY - expectedY) < 6, `${stats.medY} should stay near skin Y ${expectedY}`);
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
  const pass1Color = [150, 100, 70];
  const swapColor = [210, 80, 30];

  const pass1 = await pngFromPainter(width, height, () => pass1Color);
  const smallerSwap = await pngFromPainter(40, 40, () => swapColor);

  assert.equal(typeof masks.compositeFaceRegion, 'function');
  const alphaField = await masks.buildFaceAlphaField(geometry, width, height);
  const composited = await masks.compositeFaceRegion(pass1, smallerSwap, geometry, alphaField);
  assert.ok(composited);
  const { data, info } = await sharp(composited).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const protectedEyewear = pixelAt(data, info, 40, 38);
  const editableFace = pixelAt(data, info, 40, 55);
  const outside = pixelAt(data, info, 8, 8);

  assert.deepEqual(outside.slice(0, 3), pass1Color);
  assert.deepEqual(protectedEyewear.slice(0, 3), pass1Color);
  assert.ok(
    editableFace[0] > pass1Color[0]
      && editableFace[1] < pass1Color[1]
      && editableFace[2] < pass1Color[2],
    `editable face ${editableFace.slice(0, 3)} should move toward the swap color`,
  );
  assert.ok(
    colorDistance(editableFace, swapColor) > 1,
    `editable face ${editableFace.slice(0, 3)} should be feathered, not full swap`,
  );
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

  const alphaField = await masks.buildFaceAlphaField(geometry, width, height);
  const composited = await masks.compositeFaceRegion(pass1, swap, geometry, alphaField);
  assert.ok(composited);
  const { data, info } = await sharp(composited).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const effectiveAlpha = (x, base) => (pixelAt(data, info, x, 60)[0] - base[0]) / delta[0];
  const skinAlpha = effectiveAlpha(30, colors.skin);
  const transitionAlpha = effectiveAlpha(65, colors.transition);
  const skyAlpha = effectiveAlpha(90, colors.sky);

  assert.ok(skinAlpha > 0.9, `skin alpha ${skinAlpha} should stay strong`);
  assert.ok(transitionAlpha < skinAlpha && transitionAlpha > skyAlpha, `weights should transition smoothly: ${skinAlpha}, ${transitionAlpha}, ${skyAlpha}`);
  assert.ok(skyAlpha >= 0.1 && skyAlpha < 0.3, `non-skin alpha ${skyAlpha} must decay without becoming a hole`);
});

test('compositeFaceRegion returns null for a swap with the wrong aspect ratio', async () => {
  const width = 60;
  const height = 80;
  const geometry = {
    ellipse: { cx: 30, cy: 40, rx: 20, ry: 28, width, height },
    faceRect: { left: 8, top: 10, right: 52, bottom: 70 },
    occluderRects: [],
  };
  const pass1 = await pngFromPainter(width, height, () => [150, 100, 70]);
  const swap = await pngFromPainter(80, 60, () => [170, 120, 90]);
  const alphaField = await masks.buildFaceAlphaField(geometry, width, height);

  assert.equal(await masks.compositeFaceRegion(pass1, swap, geometry, alphaField), null);
});

test('effective alpha gate requires at least 0.12 percent of the full image', () => {
  const alpha = new Float32Array(100_000);
  alpha.fill(0.49);
  alpha.fill(0.5, 0, 119);
  assert.equal(masks.hasSufficientEffectiveAlphaArea(alpha), false);
  alpha[119] = 0.5;
  assert.equal(masks.hasSufficientEffectiveAlphaArea(alpha), true);
});
