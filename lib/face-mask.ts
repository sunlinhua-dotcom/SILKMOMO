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

export interface FaceOccluderBox2d {
  label: string;
  box2d: FaceBox2d;
}

export interface FaceMaskOccluderRect extends FaceMaskRect {
  label: string;
}

export interface FaceMaskGeometry {
  ellipse: FaceMaskEllipse;
  faceRect: FaceMaskRect;
  occluderRects: FaceMaskOccluderRect[];
}

export interface FaceEditMaskImage extends ReferenceImageInput {
  geometry: FaceMaskGeometry;
}

export interface CreateFaceEditMaskOptions {
  occluders?: string[];
  occluderBoxes2d?: FaceOccluderBox2d[];
  eyewearBox2d?: FaceBox2d | null;
  faceBox2d?: FaceBox2d;
  headPose?: FaceHeadPose;
}

export interface RawRgbaImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
}

export interface RobustSkinStats {
  count: number;
  medY: number;
  medCb: number;
  medCr: number;
  madY: number;
  madCb: number;
  madCr: number;
  refChromaMad: number;
  rejectedByLuma: number;
}

interface YCbCrColor {
  y: number;
  cb: number;
  cr: number;
}

const MIN_FACE_AREA_RATIO = 0.01;
const MASK_MARGIN_RATIO = 0.04;
const PROFILE_MASK_MARGIN_RATIO = 0.08;
const OCCLUDER_MARGIN_RATIO = 0.03;
const ALPHA_BLUR_RATIO = 0.10;
// 8-bit Gaussian step 的峰值梯度约为 1/(sqrt(2π)σ)；小脸至少取 8px，
// 避免量化后的 faceRect 边界 alpha 相邻差超过 0.06。
const ALPHA_BLUR_MIN_PX = 8;
const OCCLUDER_DILATE_SIGMAS = 1.5;
const MIN_SKIN_REFERENCE_COUNT = 64;
const SKIN_WEIGHT_FLOOR = 0.25;
const TONE_MAX_MEAN_SHIFT = 18;
const TONE_RATIO_CLAMP: [number, number] = [0.92, 1.12];
const MIN_TONE_SAMPLE_COUNT = 500;
const MIN_EFFECTIVE_ALPHA_RATIO = 0.0012;
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
  const [normalized, lossless] = await Promise.all([
    normalizeReferenceImage(input, 'face-pass-upload'),
    normalizeReferenceImage(input, 'face-pass-composite', { preserveLossless: true }),
  ]);
  const buffer = Buffer.from(lossless.data, 'base64');
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

function boxToPixelRect(
  box: FaceBox2d,
  width: number,
  height: number,
  marginRatio = 0,
): FaceMaskRect {
  const [ymin, xmin, ymax, xmax] = box;
  const boxWidth = ((xmax - xmin) / 1000) * width;
  const boxHeight = ((ymax - ymin) / 1000) * height;
  const marginX = marginRatio > 0 ? Math.max(1, boxWidth * marginRatio) : 0;
  const marginY = marginRatio > 0 ? Math.max(1, boxHeight * marginRatio) : 0;

  return {
    left: clamp((xmin / 1000) * width - marginX, 0, width),
    top: clamp((ymin / 1000) * height - marginY, 0, height),
    right: clamp((xmax / 1000) * width + marginX, 0, width),
    bottom: clamp((ymax / 1000) * height + marginY, 0, height),
  };
}

function intersectRects(first: FaceMaskRect, second: FaceMaskRect): FaceMaskRect | null {
  const intersection = {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  };
  return intersection.right > intersection.left && intersection.bottom > intersection.top
    ? intersection
    : null;
}

function containsBox(outer: FaceBox2d, inner: FaceBox2d): boolean {
  return outer[0] <= inner[0]
    && outer[1] <= inner[1]
    && outer[2] >= inner[2]
    && outer[3] >= inner[3];
}

function hullBox(first: FaceBox2d, second: FaceBox2d): FaceBox2d {
  return [
    Math.min(first[0], second[0]),
    Math.min(first[1], second[1]),
    Math.max(first[2], second[2]),
    Math.max(first[3], second[3]),
  ];
}

function validOccluderBoxes(value: FaceOccluderBox2d[] | undefined): FaceOccluderBox2d[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => (
    !!item
    && typeof item.label === 'string'
    && item.label.trim().length > 0
    && isValidBox(item.box2d)
  ));
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
  let faceBox2d = isValidBox(options.faceBox2d)
    ? options.faceBox2d
    : visibleFaceBox2d;
  if (!containsBox(faceBox2d, visibleFaceBox2d)) {
    console.log('[face-geom] faceBox2d 未包含 visibleFaceBox2d，已扩到包含壳', { faceBox2d, visibleFaceBox2d });
    faceBox2d = hullBox(faceBox2d, visibleFaceBox2d);
  }
  const marginRatio = options.headPose === 'profile'
    ? PROFILE_MASK_MARGIN_RATIO
    : MASK_MARGIN_RATIO;
  const faceRect = boxToPixelRect(faceBox2d, width, height, marginRatio);
  const occluderBoxes = validOccluderBoxes(options.occluderBoxes2d);
  const eyewearBox2d = isValidBox(options.eyewearBox2d)
    ? options.eyewearBox2d
    : null;
  const hasGenericEyewearBox = occluderBoxes.some(item => EYEWEAR_OCCLUDER_RE.test(item.label));
  const hasPreciseEyewearBox = hasGenericEyewearBox || !!eyewearBox2d;
  if (eyewearBox2d && !hasGenericEyewearBox) {
    occluderBoxes.push({ label: 'eyewear', box2d: eyewearBox2d });
  }
  const adjusted = hasEyewear && !hasPreciseEyewearBox
    ? adjustBoxForOccluders(visibleFaceBox2d, options.occluders)
    : { box: visibleFaceBox2d };
  const ellipse = boxToEllipse(adjusted.box, width, height, marginRatio, adjusted.minTop);
  const occluderRects = occluderBoxes.flatMap<FaceMaskOccluderRect>(item => {
    const expanded = boxToPixelRect(item.box2d, width, height, OCCLUDER_MARGIN_RATIO);
    const clipped = intersectRects(expanded, faceRect);
    return clipped ? [{ label: item.label.trim(), ...clipped }] : [];
  });
  const ellipseSvg = Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="face-bounds">
      <rect x="${faceRect.left}" y="${faceRect.top}" width="${faceRect.right - faceRect.left}" height="${faceRect.bottom - faceRect.top}"/>
    </clipPath>
  </defs>
  <ellipse cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="black" clip-path="url(#face-bounds)"/>
</svg>`);
  const occludersSvg = occluderRects.length > 0
    ? Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${occluderRects.map(rect => (
    `<rect x="${rect.left}" y="${rect.top}" width="${rect.right - rect.left}" height="${rect.bottom - rect.top}" fill="black"/>`
  )).join('\n  ')}
</svg>`)
    : null;
  const composites: sharp.OverlayOptions[] = [
    { input: ellipseSvg, blend: 'dest-out' },
  ];
  if (occludersSvg) composites.push({ input: occludersSvg, blend: 'over' });

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
    geometry: { ellipse, faceRect, occluderRects },
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

function isInsideRect(rect: FaceMaskRect, x: number, y: number): boolean {
  const px = x + 0.5;
  const py = y + 0.5;
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
}

function isInsideAnyRect(rects: FaceMaskRect[], x: number, y: number): boolean {
  return rects.some(rect => isInsideRect(rect, x, y));
}

function isSkinChromaPixel(image: RawRgbaImage, offset: number): boolean {
  const r = image.data[offset];
  const g = image.data[offset + 1];
  const b = image.data[offset + 2];
  const a = image.channels > 3 ? image.data[offset + 3] : 255;
  if (a < 16) return false;

  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

function medianAbsoluteDeviation(values: number[], center: number): number {
  return median(values.map(value => Math.abs(value - center)));
}

export function collectSkinStatsRobust(
  image: RawRgbaImage,
  geometry: FaceMaskGeometry,
  acceptsRadius: (radius: number) => boolean,
  restrictToFaceBounds = false,
): RobustSkinStats {
  const { ellipse, faceRect, occluderRects } = geometry;
  const candidates: YCbCrColor[] = [];

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const radius = ellipseDistance(ellipse, x, y);
      if (!acceptsRadius(radius)) continue;
      if (restrictToFaceBounds && !isInsideRect(faceRect, x, y)) continue;
      if (isInsideAnyRect(occluderRects, x, y)) continue;

      const offset = (y * image.width + x) * image.channels;
      if (!isSkinChromaPixel(image, offset)) continue;
      candidates.push(rgbToYCbCr(
        image.data[offset],
        image.data[offset + 1],
        image.data[offset + 2],
      ));
    }
  }

  const preliminaryMedY = median(candidates.map(color => color.y));
  const minY = preliminaryMedY * 0.65;
  const maxY = preliminaryMedY * 1.45;
  const accepted = candidates.filter(color => color.y >= minY && color.y <= maxY);
  const ys = accepted.map(color => color.y);
  const cbs = accepted.map(color => color.cb);
  const crs = accepted.map(color => color.cr);
  const medY = median(ys);
  const medCb = median(cbs);
  const medCr = median(crs);
  const madY = medianAbsoluteDeviation(ys, medY);
  const madCb = medianAbsoluteDeviation(cbs, medCb);
  const madCr = medianAbsoluteDeviation(crs, medCr);
  return {
    count: accepted.length,
    medY,
    medCb,
    medCr,
    madY,
    madCb,
    madCr,
    refChromaMad: Math.hypot(madCb, madCr),
    rejectedByLuma: candidates.length - accepted.length,
  };
}

function smoothstepRange(min: number, max: number, value: number): number {
  const t = clamp((value - min) / Math.max(0.001, max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function rgbToYCbCr(r: number, g: number, b: number): YCbCrColor {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

function yCbCrToRgb(y: number, cb: number, cr: number): [number, number, number] {
  const centeredCb = cb - 128;
  const centeredCr = cr - 128;
  return [
    clamp(y + 1.402 * centeredCr, 0, 255),
    clamp(y - 0.344136 * centeredCb - 0.714136 * centeredCr, 0, 255),
    clamp(y + 1.772 * centeredCb, 0, 255),
  ];
}

function skinSimilarityWeight(
  image: RawRgbaImage,
  offset: number,
  reference: YCbCrColor | null,
  refChromaMad: number,
): number {
  if (!reference) return 0.85;
  const color = rgbToYCbCr(
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
  );
  const distance = Math.hypot(
    (color.y - reference.y) * 0.35,
    color.cb - reference.cb,
    color.cr - reference.cr,
  );
  const fullWeightDistance = Math.max(12, 1.5 * refChromaMad);
  const floorWeightDistance = Math.max(45, 4 * refChromaMad);
  const falloff = smoothstepRange(
    fullWeightDistance,
    floorWeightDistance,
    distance,
  );
  return SKIN_WEIGHT_FLOOR + (1 - SKIN_WEIGHT_FLOOR) * (1 - falloff);
}

function softSaturate(value: number, limit: number): number {
  return limit * Math.tanh(value / limit);
}

function rectSvg(rect: FaceMaskRect): string {
  return `<rect x="${rect.left}" y="${rect.top}" width="${rect.right - rect.left}" height="${rect.bottom - rect.top}"/>`;
}

export async function buildFaceAlphaField(
  geometry: FaceMaskGeometry,
  width: number,
  height: number,
): Promise<Float32Array> {
  const { ellipse, faceRect, occluderRects } = geometry;
  if (ellipse.width !== width || ellipse.height !== height) {
    throw new Error(`alpha geometry size mismatch: ${ellipse.width}x${ellipse.height} != ${width}x${height}`);
  }
  const sigma = clamp(
    Math.max(ALPHA_BLUR_MIN_PX, ALPHA_BLUR_RATIO * Math.min(ellipse.rx, ellipse.ry)),
    ALPHA_BLUR_MIN_PX,
    14,
  );
  const dilate = Math.ceil(OCCLUDER_DILATE_SIGMAS * sigma);
  const expandedOccluders = occluderRects.flatMap(rect => {
    const expanded = {
      left: rect.left - dilate,
      top: rect.top - dilate,
      right: rect.right + dilate,
      bottom: rect.bottom + dilate,
    };
    const clipped = intersectRects(expanded, faceRect);
    return clipped ? [clipped] : [];
  });
  const supportSvg = Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="black"/>
  <defs><clipPath id="face-bounds">${rectSvg(faceRect)}</clipPath></defs>
  <ellipse cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="white" clip-path="url(#face-bounds)"/>
  ${expandedOccluders.map(rect => `<rect x="${rect.left}" y="${rect.top}" width="${rect.right - rect.left}" height="${rect.bottom - rect.top}" fill="black"/>`).join('\n  ')}
</svg>`);
  const { data, info } = await sharp(supportSvg)
    .greyscale()
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) {
    throw new Error(`alpha raster size mismatch: ${info.width}x${info.height}`);
  }
  const alpha = new Float32Array(width * height);
  for (let index = 0; index < alpha.length; index++) alpha[index] = data[index] / 255;
  return alpha;
}

export function effectiveAlphaArea(alphaField: Float32Array): { pixels: number; ratio: number } {
  let pixels = 0;
  for (const alpha of alphaField) {
    if (alpha >= 0.5) pixels++;
  }
  return {
    pixels,
    ratio: alphaField.length > 0 ? pixels / alphaField.length : 0,
  };
}

export function hasSufficientEffectiveAlphaArea(alphaField: Float32Array): boolean {
  return effectiveAlphaArea(alphaField).ratio >= MIN_EFFECTIVE_ALPHA_RATIO;
}

export async function alignSwapTone(
  pass1Png: Buffer,
  swapPng: Buffer,
  geometry: FaceMaskGeometry,
): Promise<Buffer> {
  const { ellipse } = geometry;
  if (!Number.isFinite(ellipse.cx) || !Number.isFinite(ellipse.cy) || ellipse.rx <= 0 || ellipse.ry <= 0) {
    return swapPng;
  }

  const pass1 = await readRgbaImage(pass1Png);
  const swapMeta = await sharp(swapPng).metadata();
  if (!swapMeta.width || !swapMeta.height) return swapPng;
  const arSwap = swapMeta.width / swapMeta.height;
  const arBase = pass1.width / pass1.height;
  if (Math.abs(arSwap - arBase) / arBase > 0.005) return swapPng;
  const fittedSwapPng = swapMeta.width === pass1.width && swapMeta.height === pass1.height
    ? swapPng
    : await sharp(swapPng).resize(pass1.width, pass1.height, { fit: 'fill' }).png().toBuffer();
  const swap = await readRgbaImage(fittedSwapPng);
  if (pass1.width !== ellipse.width || pass1.height !== ellipse.height) {
    console.log('[face-tone-align] skip: geometry size mismatch', {
      pass1: `${pass1.width}x${pass1.height}`,
      ellipse: `${ellipse.width}x${ellipse.height}`,
    });
    return fittedSwapPng;
  }

  const referenceStats = collectSkinStatsRobust(pass1, geometry, radius => radius <= 0.92, true);
  const targetStats = collectSkinStatsRobust(swap, geometry, radius => radius <= 0.92, true);
  if (referenceStats.count < MIN_TONE_SAMPLE_COUNT || targetStats.count < MIN_TONE_SAMPLE_COUNT) {
    console.log('[face-tone-align] skip: skin samples too few', {
      referenceCount: referenceStats.count,
      targetCount: targetStats.count,
    });
    return fittedSwapPng;
  }

  const dY = softSaturate(referenceStats.medY - targetStats.medY, TONE_MAX_MEAN_SHIFT);
  const dCb = softSaturate(referenceStats.medCb - targetStats.medCb, TONE_MAX_MEAN_SHIFT);
  const dCr = softSaturate(referenceStats.medCr - targetStats.medCr, TONE_MAX_MEAN_SHIFT);
  const gY = clamp(
    referenceStats.madY / Math.max(1, targetStats.madY),
    TONE_RATIO_CLAMP[0],
    TONE_RATIO_CLAMP[1],
  );
  const output = Buffer.from(swap.data);
  for (let offset = 0; offset < swap.data.length; offset += swap.channels) {
    const color = rgbToYCbCr(swap.data[offset], swap.data[offset + 1], swap.data[offset + 2]);
    const nextY = clamp((color.y - targetStats.medY) * gY + targetStats.medY + dY, 0, 255);
    const next = yCbCrToRgb(
      nextY,
      clamp(color.cb + dCb, 0, 255),
      clamp(color.cr + dCr, 0, 255),
    );
    output[offset] = Math.round(next[0]);
    output[offset + 1] = Math.round(next[1]);
    output[offset + 2] = Math.round(next[2]);
  }

  return sharp(output, {
    raw: {
      width: swap.width,
      height: swap.height,
      channels: swap.channels,
    },
  })
    .png()
    .toBuffer();
}

export async function compositeFaceRegion(
  pass1Png: Buffer,
  alignedSwapPng: Buffer,
  geometry: FaceMaskGeometry,
  alphaField: Float32Array,
): Promise<Buffer | null> {
  const { ellipse } = geometry;
  if (!Number.isFinite(ellipse.cx) || !Number.isFinite(ellipse.cy) || ellipse.rx <= 0 || ellipse.ry <= 0) {
    return null;
  }

  const pass1 = await readRgbaImage(pass1Png);
  const ellipseMatchesPass1 = pass1.width === ellipse.width && pass1.height === ellipse.height;
  if (!ellipseMatchesPass1) {
    console.log('[face-composite] skip: ellipse size mismatch', {
      pass1: `${pass1.width}x${pass1.height}`,
      ellipse: `${ellipse.width}x${ellipse.height}`,
    });
    return null;
  }

  const swapMeta = await sharp(alignedSwapPng).metadata();
  console.log('[face-composite] swap image metadata', {
    size: `${swapMeta.width ?? 0}x${swapMeta.height ?? 0}`,
    format: swapMeta.format ?? 'unknown',
  });
  if (!swapMeta.width || !swapMeta.height) return null;
  const arSwap = swapMeta.width / swapMeta.height;
  const arBase = pass1.width / pass1.height;
  if (Math.abs(arSwap - arBase) / arBase > 0.005) {
    console.log('[face-composite] swap 宽高比不符，放弃合成', {
      swap: `${swapMeta.width}x${swapMeta.height}`,
      base: `${pass1.width}x${pass1.height}`,
    });
    return null;
  }
  if (alphaField.length !== pass1.width * pass1.height) {
    console.log('[face-composite] alpha size mismatch', {
      alpha: alphaField.length,
      base: pass1.width * pass1.height,
    });
    return null;
  }
  const swapBuffer = await sharp(alignedSwapPng)
    .resize(pass1.width, pass1.height, { fit: 'fill' })
    .png()
    .toBuffer();
  const swap = await readRgbaImage(swapBuffer);
  const output = Buffer.from(pass1.data);
  const skinStats = collectSkinStatsRobust(pass1, geometry, radius => radius <= 0.92, true);
  const skinReference = skinStats.count >= MIN_SKIN_REFERENCE_COUNT
    ? { y: skinStats.medY, cb: skinStats.medCb, cr: skinStats.medCr }
    : null;
  if (!skinReference) {
    console.log('[face-composite] skin reference unavailable', { count: skinStats.count });
  }

  for (let y = 0; y < pass1.height; y++) {
    for (let x = 0; x < pass1.width; x++) {
      const alpha = alphaField[y * pass1.width + x];
      if (alpha <= 0.002) continue;
      const offset = (y * pass1.width + x) * pass1.channels;
      const weightedAlpha = alpha * skinSimilarityWeight(pass1, offset, skinReference, skinStats.refChromaMad);
      for (let c = 0; c < 3; c++) {
        output[offset + c] = Math.round(
          swap.data[offset + c] * weightedAlpha
          + pass1.data[offset + c] * (1 - weightedAlpha),
        );
      }
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
