import sharp from 'sharp';
import { normalizeReferenceImage, type ReferenceImageInput } from './reference-image-normalizer';

export type FaceBox2d = [number, number, number, number]; // [ymin, xmin, ymax, xmax], normalized 0-1000
export type FaceVisibility = 'clear' | 'partial' | 'heavy' | 'none';
export type FaceHeadPose = 'frontal' | 'three-quarter' | 'profile';

export interface FaceRegionForMask {
  visibility: FaceVisibility;
  visibleFaceBox2d: FaceBox2d;
}

export interface NormalizedFacePassImage extends ReferenceImageInput {
  width: number;
  height: number;
  buffer: Buffer;
}

export interface FaceMaskEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  width: number;
  height: number;
}

export interface FaceMaskRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface FaceMaskGeometry {
  ellipse: FaceMaskEllipse;
  eyewearRect: FaceMaskRect | null;
}

export interface FaceEditMaskImage extends ReferenceImageInput {
  geometry: FaceMaskGeometry;
}

export interface CreateFaceEditMaskOptions {
  occluders?: string[];
  eyewearBox2d?: FaceBox2d | null;
  headPose?: FaceHeadPose;
}

interface RawRgbaImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
}

interface SkinStats {
  count: number;
  mean: [number, number, number];
  std: [number, number, number];
}

const MIN_FACE_AREA_RATIO = 0.01;
const MASK_MARGIN_RATIO = 0.04;
const PROFILE_MASK_MARGIN_RATIO = 0.08;
const EYEWEAR_MARGIN_RATIO = 0.04;
const EYEWEAR_FEATHER_RATIO = 0.04;
const MIN_TONE_SAMPLE_COUNT = 500;
const EYEWEAR_OCCLUDER_RE = /sun?glass|eye ?glass|glasses|eyewear/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isValidBox(box: unknown): box is FaceBox2d {
  if (!Array.isArray(box) || box.length !== 4) return false;
  if (!box.every(v => typeof v === 'number' && Number.isFinite(v))) return false;
  const [ymin, xmin, ymax, xmax] = box;
  return ymin >= 0 && xmin >= 0 && ymax <= 1000 && xmax <= 1000 && ymax > ymin && xmax > xmin;
}

export async function normalizeImageForFacePass(input: ReferenceImageInput): Promise<NormalizedFacePassImage> {
  const normalized = await normalizeReferenceImage(input, 'face-pass-base');
  const buffer = Buffer.from(normalized.data, 'base64');
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error('无法读取 Pass2 底图尺寸');
  }
  return { ...normalized, width, height, buffer };
}

export function isUsableFaceRegion(region: FaceRegionForMask | null): region is FaceRegionForMask {
  if (!region || region.visibility === 'heavy' || region.visibility === 'none') return false;
  if (!isValidBox(region.visibleFaceBox2d)) return false;
  const [ymin, xmin, ymax, xmax] = region.visibleFaceBox2d;
  const areaRatio = ((ymax - ymin) / 1000) * ((xmax - xmin) / 1000);
  return areaRatio >= MIN_FACE_AREA_RATIO;
}

function hasEyewearOccluder(occluders: string[] | undefined): boolean {
  return !!occluders?.some(item => EYEWEAR_OCCLUDER_RE.test(item));
}

function adjustBoxForOccluders(box: FaceBox2d, occluders: string[] | undefined): { box: FaceBox2d; minTop?: number } {
  if (!hasEyewearOccluder(occluders)) return { box };
  const [ymin, xmin, ymax, xmax] = box;
  const raisedYmin = Math.min(ymax - 1, ymin + 0.45 * (ymax - ymin));
  return { box: [raisedYmin, xmin, ymax, xmax], minTop: raisedYmin };
}

function boxToEllipse(
  box: FaceBox2d,
  width: number,
  height: number,
  marginRatio: number,
  minTop?: number,
): FaceMaskEllipse {
  const [ymin, xmin, ymax, xmax] = box;
  const boxWidth = ((xmax - xmin) / 1000) * width;
  const boxHeight = ((ymax - ymin) / 1000) * height;
  const marginX = boxWidth * marginRatio;
  const marginY = boxHeight * marginRatio;

  const left = clamp((xmin / 1000) * width - marginX, 0, width);
  const right = clamp((xmax / 1000) * width + marginX, 0, width);
  const minTopPx = minTop === undefined ? 0 : (minTop / 1000) * height;
  const top = clamp((ymin / 1000) * height - marginY, minTopPx, height);
  const bottom = clamp((ymax / 1000) * height + marginY, 0, height);

  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    rx: Math.max(1, (right - left) / 2),
    ry: Math.max(1, (bottom - top) / 2),
    width,
    height,
  };
}

function boxToPixelRect(box: FaceBox2d, width: number, height: number): FaceMaskRect {
  const [ymin, xmin, ymax, xmax] = box;
  const boxWidth = ((xmax - xmin) / 1000) * width;
  const boxHeight = ((ymax - ymin) / 1000) * height;
  const marginX = Math.max(1, boxWidth * EYEWEAR_MARGIN_RATIO);
  const marginY = Math.max(1, boxHeight * EYEWEAR_MARGIN_RATIO);

  return {
    left: clamp((xmin / 1000) * width - marginX, 0, width),
    top: clamp((ymin / 1000) * height - marginY, 0, height),
    right: clamp((xmax / 1000) * width + marginX, 0, width),
    bottom: clamp((ymax / 1000) * height + marginY, 0, height),
  };
}

export async function createFaceEditMask(
  image: Pick<NormalizedFacePassImage, 'width' | 'height'>,
  visibleFaceBox2d: FaceBox2d,
  options: CreateFaceEditMaskOptions = {},
): Promise<FaceEditMaskImage> {
  if (!isValidBox(visibleFaceBox2d)) {
    throw new Error('可见脸部 bbox 非法');
  }
  const { width, height } = image;
  const hasEyewear = hasEyewearOccluder(options.occluders);
  const eyewearBox2d = isValidBox(options.eyewearBox2d)
    ? options.eyewearBox2d
    : null;
  const adjusted = hasEyewear && !eyewearBox2d
    ? adjustBoxForOccluders(visibleFaceBox2d, options.occluders)
    : { box: visibleFaceBox2d };
  const marginRatio = options.headPose === 'profile'
    ? PROFILE_MASK_MARGIN_RATIO
    : MASK_MARGIN_RATIO;
  const ellipse = boxToEllipse(adjusted.box, width, height, marginRatio, adjusted.minTop);
  const eyewearRect = eyewearBox2d
    ? boxToPixelRect(eyewearBox2d, width, height)
    : null;
  const ellipseSvg = Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="black"/>
</svg>`);
  const eyewearSvg = eyewearRect
    ? Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${eyewearRect.left}" y="${eyewearRect.top}" width="${eyewearRect.right - eyewearRect.left}" height="${eyewearRect.bottom - eyewearRect.top}" fill="black"/>
</svg>`)
    : null;
  const composites: sharp.OverlayOptions[] = [
    { input: ellipseSvg, blend: 'dest-out' },
  ];
  if (eyewearSvg) composites.push({ input: eyewearSvg, blend: 'over' });

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return {
    data: buffer.toString('base64'),
    mimeType: 'image/png',
    geometry: { ellipse, eyewearRect },
  };
}

async function readRgbaImage(buffer: Buffer): Promise<RawRgbaImage> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    channels: 4,
  };
}

function ellipseDistance(ellipse: FaceMaskEllipse, x: number, y: number): number {
  const dx = (x + 0.5 - ellipse.cx) / ellipse.rx;
  const dy = (y + 0.5 - ellipse.cy) / ellipse.ry;
  return Math.sqrt(dx * dx + dy * dy);
}

function isInsideRect(rect: FaceMaskRect | null, x: number, y: number): boolean {
  if (!rect) return false;
  const px = x + 0.5;
  const py = y + 0.5;
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
}

function exclusionFeatherAlpha(rect: FaceMaskRect | null, x: number, y: number, featherPx: number): number {
  if (!rect) return 1;
  if (isInsideRect(rect, x, y)) return 0;

  const px = x + 0.5;
  const py = y + 0.5;
  const dx = px < rect.left ? rect.left - px : px > rect.right ? px - rect.right : 0;
  const dy = py < rect.top ? rect.top - py : py > rect.bottom ? py - rect.bottom : 0;
  return smoothstepRange(0, featherPx, Math.hypot(dx, dy));
}

function isSkinPixel(image: RawRgbaImage, offset: number): boolean {
  const r = image.data[offset];
  const g = image.data[offset + 1];
  const b = image.data[offset + 2];
  const a = image.channels > 3 ? image.data[offset + 3] : 255;
  if (a < 16) return false;

  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

function collectSkinStats(
  image: RawRgbaImage,
  geometry: FaceMaskGeometry,
  acceptsRadius: (radius: number) => boolean,
): SkinStats {
  const { ellipse, eyewearRect } = geometry;
  const sum: [number, number, number] = [0, 0, 0];
  const sumSq: [number, number, number] = [0, 0, 0];
  let count = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const radius = ellipseDistance(ellipse, x, y);
      if (!acceptsRadius(radius)) continue;
      if (isInsideRect(eyewearRect, x, y)) continue;

      const offset = (y * image.width + x) * image.channels;
      if (!isSkinPixel(image, offset)) continue;

      for (let c = 0; c < 3; c++) {
        const value = image.data[offset + c];
        sum[c] += value;
        sumSq[c] += value * value;
      }
      count++;
    }
  }

  if (count === 0) return { count, mean: [0, 0, 0], std: [0, 0, 0] };

  const mean = sum.map(value => value / count) as [number, number, number];
  const std = sumSq.map((value, index) => {
    const variance = Math.max(0, value / count - mean[index] * mean[index]);
    return Math.sqrt(variance);
  }) as [number, number, number];

  return { count, mean, std };
}

function gaussianFeatherAlpha(radius: number, featherNorm: number): number {
  const fullStrengthRadius = Math.max(0, 1 - featherNorm);
  if (radius <= fullStrengthRadius) return 1;
  const sigma = Math.max(0.001, featherNorm / 3);
  return clamp(Math.exp(-0.5 * ((radius - fullStrengthRadius) / sigma) ** 2), 0, 1);
}

function smoothstepRange(min: number, max: number, value: number): number {
  const t = clamp((value - min) / Math.max(0.001, max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function pixelLuma(image: RawRgbaImage, offset: number): number {
  return (
    image.data[offset] * 0.2126
    + image.data[offset + 1] * 0.7152
    + image.data[offset + 2] * 0.0722
  );
}

function sameDimensions(first: RawRgbaImage, second: RawRgbaImage, geometry: FaceMaskGeometry): boolean {
  const { ellipse } = geometry;
  return (
    first.width === second.width
    && first.height === second.height
    && first.width === ellipse.width
    && first.height === ellipse.height
  );
}

export async function harmonizeFaceTone(
  pass1Png: Buffer,
  pass2Png: Buffer,
  geometry: FaceMaskGeometry,
): Promise<Buffer> {
  const { ellipse, eyewearRect } = geometry;
  if (!Number.isFinite(ellipse.cx) || !Number.isFinite(ellipse.cy) || ellipse.rx <= 0 || ellipse.ry <= 0) {
    return pass2Png;
  }

  const [pass1, pass2] = await Promise.all([
    readRgbaImage(pass1Png),
    readRgbaImage(pass2Png),
  ]);

  if (!sameDimensions(pass1, pass2, geometry)) {
    console.log('[face-tone-harmonize] skip: image size mismatch', {
      pass1: `${pass1.width}x${pass1.height}`,
      pass2: `${pass2.width}x${pass2.height}`,
      ellipse: `${ellipse.width}x${ellipse.height}`,
    });
    return pass2Png;
  }

  const referenceStats = collectSkinStats(pass1, geometry, radius => radius >= 1.15 && radius <= 1.45);
  const targetStats = collectSkinStats(pass2, geometry, radius => radius <= 1);
  if (referenceStats.count < MIN_TONE_SAMPLE_COUNT || targetStats.count < MIN_TONE_SAMPLE_COUNT) {
    console.log('[face-tone-harmonize] skip: skin samples too few', {
      referenceCount: referenceStats.count,
      targetCount: targetStats.count,
    });
    return pass2Png;
  }

  const output = Buffer.from(pass2.data);
  const transferRatio = referenceStats.std.map((std, index) => {
    const ratio = std / Math.max(1, targetStats.std[index]);
    return clamp(Number.isFinite(ratio) ? ratio : 1, 0.6, 1.6);
  });
  const featherNorm = clamp((Math.min(ellipse.rx, ellipse.ry) * 0.08) / Math.max(1, Math.min(ellipse.rx, ellipse.ry)), 0.01, 0.5);
  const exclusionFeatherPx = Math.max(1, Math.min(ellipse.rx, ellipse.ry) * EYEWEAR_FEATHER_RATIO);

  for (let y = 0; y < pass2.height; y++) {
    for (let x = 0; x < pass2.width; x++) {
      const radius = ellipseDistance(ellipse, x, y);
      if (radius > 1) continue;

      const offset = (y * pass2.width + x) * pass2.channels;
      const edgeAlpha = gaussianFeatherAlpha(radius, featherNorm);
      const darkWeight = smoothstepRange(30, 70, pixelLuma(pass2, offset));
      const exclusionAlpha = exclusionFeatherAlpha(eyewearRect, x, y, exclusionFeatherPx);
      const applyAlpha = edgeAlpha * exclusionAlpha * darkWeight * 0.9;
      if (applyAlpha <= 0) continue;

      for (let c = 0; c < 3; c++) {
        const transferred = clamp(
          (pass2.data[offset + c] - targetStats.mean[c]) * transferRatio[c] + referenceStats.mean[c],
          0,
          255,
        );
        output[offset + c] = Math.round(pass2.data[offset + c] * (1 - applyAlpha) + transferred * applyAlpha);
      }
    }
  }

  return sharp(output, {
    raw: {
      width: pass2.width,
      height: pass2.height,
      channels: pass2.channels,
    },
  })
    .png()
    .toBuffer();
}

export async function compositeFaceRegion(
  pass1Png: Buffer,
  swapPng: Buffer,
  geometry: FaceMaskGeometry,
): Promise<Buffer> {
  const { ellipse, eyewearRect } = geometry;
  if (!Number.isFinite(ellipse.cx) || !Number.isFinite(ellipse.cy) || ellipse.rx <= 0 || ellipse.ry <= 0) {
    return pass1Png;
  }

  const pass1 = await readRgbaImage(pass1Png);
  const ellipseMatchesPass1 = pass1.width === ellipse.width && pass1.height === ellipse.height;
  if (!ellipseMatchesPass1) {
    console.log('[face-composite] skip: ellipse size mismatch', {
      pass1: `${pass1.width}x${pass1.height}`,
      ellipse: `${ellipse.width}x${ellipse.height}`,
    });
    return pass1Png;
  }

  const swapBuffer = await sharp(swapPng)
    .resize(pass1.width, pass1.height, { fit: 'fill' })
    .png()
    .toBuffer();
  const swap = await readRgbaImage(swapBuffer);
  const output = Buffer.from(pass1.data);
  const featherNorm = clamp((Math.min(ellipse.rx, ellipse.ry) * 0.08) / Math.max(1, Math.min(ellipse.rx, ellipse.ry)), 0.01, 0.5);
  const exclusionFeatherPx = Math.max(1, Math.min(ellipse.rx, ellipse.ry) * EYEWEAR_FEATHER_RATIO);

  for (let y = 0; y < pass1.height; y++) {
    for (let x = 0; x < pass1.width; x++) {
      const radius = ellipseDistance(ellipse, x, y);
      if (radius > 1) continue;

      const alpha = gaussianFeatherAlpha(radius, featherNorm)
        * exclusionFeatherAlpha(eyewearRect, x, y, exclusionFeatherPx);
      if (alpha <= 0) continue;

      const offset = (y * pass1.width + x) * pass1.channels;
      for (let c = 0; c < 3; c++) {
        output[offset + c] = Math.round(swap.data[offset + c] * alpha + pass1.data[offset + c] * (1 - alpha));
      }
      output[offset + 3] = Math.round(swap.data[offset + 3] * alpha + pass1.data[offset + 3] * (1 - alpha));
    }
  }

  return sharp(output, {
    raw: {
      width: pass1.width,
      height: pass1.height,
      channels: pass1.channels,
    },
  })
    .png()
    .toBuffer();
}
