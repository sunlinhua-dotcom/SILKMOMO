import sharp from 'sharp';
import { normalizeReferenceImage, type ReferenceImageInput } from './reference-image-normalizer';

export type FaceBox2d = [number, number, number, number]; // [ymin, xmin, ymax, xmax], normalized 0-1000
export type FaceVisibility = 'clear' | 'partial' | 'heavy' | 'none';

export interface FaceRegionForMask {
  visibility: FaceVisibility;
  visibleFaceBox2d: FaceBox2d;
}

export interface NormalizedFacePassImage extends ReferenceImageInput {
  width: number;
  height: number;
  buffer: Buffer;
}

const MIN_FACE_AREA_RATIO = 0.01;
const MASK_MARGIN_RATIO = 0.04;
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

function boxToEllipse(box: FaceBox2d, width: number, height: number, minTop?: number) {
  const [ymin, xmin, ymax, xmax] = box;
  const boxWidth = ((xmax - xmin) / 1000) * width;
  const boxHeight = ((ymax - ymin) / 1000) * height;
  const marginX = boxWidth * MASK_MARGIN_RATIO;
  const marginY = boxHeight * MASK_MARGIN_RATIO;

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
  };
}

export async function createFaceEditMask(
  image: Pick<NormalizedFacePassImage, 'width' | 'height'>,
  visibleFaceBox2d: FaceBox2d,
  occluders?: string[],
): Promise<ReferenceImageInput> {
  if (!isValidBox(visibleFaceBox2d)) {
    throw new Error('可见脸部 bbox 非法');
  }
  const { width, height } = image;
  const adjusted = adjustBoxForOccluders(visibleFaceBox2d, occluders);
  const ellipse = boxToEllipse(adjusted.box, width, height, adjusted.minTop);
  const ellipseSvg = Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="${ellipse.cx}" cy="${ellipse.cy}" rx="${ellipse.rx}" ry="${ellipse.ry}" fill="black"/>
</svg>`);

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: ellipseSvg, blend: 'dest-out' }])
    .png()
    .toBuffer();

  return { data: buffer.toString('base64'), mimeType: 'image/png' };
}
