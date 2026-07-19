import sharp from 'sharp';

export interface ReferenceImageInput {
  data: string;
  mimeType: string;
}

export const REFERENCE_IMAGE_MAX_BYTES = 800 * 1024;
export const REFERENCE_IMAGE_MAX_DIMENSION = 1920;

const JPEG_QUALITIES = [82, 74, 66, 58, 50, 42] as const;

function safeMimeType(mimeType: string): string {
  return mimeType.replace(/[\r\n]/g, '').slice(0, 80) || 'unknown';
}

function dimensionLabel(width?: number, height?: number): string {
  return width && height ? `${width}x${height}` : 'unknown';
}

function nextMaxDimension(current: number, outputBytes: number): number {
  if (current <= 1) return 1;
  const estimatedScale = Math.sqrt(REFERENCE_IMAGE_MAX_BYTES / outputBytes) * 0.95;
  const scale = Math.min(0.85, estimatedScale);
  return Math.max(1, Math.min(current - 1, Math.floor(current * scale)));
}

async function encodeAtDimension(
  input: Buffer,
  maxDimension: number,
  preserveTransparency: boolean,
  jpegQuality?: number,
) {
  const pipeline = sharp(input)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });

  return preserveTransparency
    ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
    : pipeline.jpeg({ quality: jpegQuality ?? JPEG_QUALITIES[0], progressive: true }).toBuffer({ resolveWithObject: true });
}

/**
 * 归一化单张即将上行的参考图。
 *
 * 失败时始终原样返回，避免图片预处理故障改变既有生成/退款语义。
 * 每次调用只打印一行尺寸与体积日志，不包含 URL、令牌或图片内容。
 */
export async function normalizeReferenceImage<T extends ReferenceImageInput>(
  input: T,
  label = 'reference',
): Promise<T> {
  const declaredMime = safeMimeType(input.mimeType);
  let inputBuffer: Buffer | undefined;
  let inputDimensions = 'unknown';

  try {
    inputBuffer = Buffer.from(input.data, 'base64');
    const metadata = await sharp(inputBuffer).metadata();
    const orientedWidth = metadata.autoOrient?.width ?? metadata.width;
    const orientedHeight = metadata.autoOrient?.height ?? metadata.height;
    inputDimensions = dimensionLabel(orientedWidth, orientedHeight);

    const stats = metadata.hasAlpha ? await sharp(inputBuffer).stats() : undefined;
    const preserveTransparency = metadata.hasAlpha && stats?.isOpaque === false;

    let maxDimension = REFERENCE_IMAGE_MAX_DIMENSION;

    while (true) {
      let encoded: Awaited<ReturnType<typeof encodeAtDimension>>;
      if (preserveTransparency) {
        encoded = await encodeAtDimension(inputBuffer, maxDimension, true);
      } else {
        encoded = await encodeAtDimension(inputBuffer, maxDimension, false, JPEG_QUALITIES[0]);
        for (const quality of JPEG_QUALITIES.slice(1)) {
          if (encoded.data.length <= REFERENCE_IMAGE_MAX_BYTES) break;
          encoded = await encodeAtDimension(inputBuffer, maxDimension, false, quality);
        }
      }

      if (encoded.data.length <= REFERENCE_IMAGE_MAX_BYTES) {
        const outputMime = preserveTransparency ? 'image/png' : 'image/jpeg';
        console.info(
          `[ref-image-normalize] ${label}: ${inputBuffer.length}B ${declaredMime} ${inputDimensions} -> ` +
          `${encoded.data.length}B ${outputMime} ${dimensionLabel(encoded.info.width, encoded.info.height)}`,
        );

        return {
          ...input,
          data: encoded.data.toString('base64'),
          mimeType: outputMime,
        };
      }
      if (maxDimension === 1) throw new Error('无法将参考图压缩到安全上限');
      maxDimension = nextMaxDimension(maxDimension, encoded.data.length);
    }
  } catch {
    console.info(
      `[ref-image-normalize] ${label}: ${inputBuffer?.length ?? 0}B ${declaredMime} ${inputDimensions} -> ` +
      `${inputBuffer?.length ?? 0}B ${declaredMime} ${inputDimensions} (fallback=original)`,
    );
    return input;
  }
}
