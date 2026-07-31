import sharp from 'sharp';

export interface NormalizedGeneratedImage {
  b64: string;
  width: number;
  height: number;
  adjusted: boolean;
}

const ASPECT_RATIO_TOLERANCE = 0.02;
const MAX_CROP_AREA_LOSS = 0.25;
const MAX_UPSCALE_FACTOR = 1.35;

function unchanged(b64: string, width = 0, height = 0): NormalizedGeneratedImage {
  return { b64, width, height, adjusted: false };
}

/**
 * 将上游生成图尽量对齐 UI 声明的像素尺寸。
 *
 * 该函数是 fail-open 的：任何解码、裁切、缩放或编码异常都会返回原图，绝不向生成/计费链路抛错。
 */
export async function normalizeGeneratedImage(
  b64: string,
  declaredW?: number,
  declaredH?: number,
): Promise<NormalizedGeneratedImage> {
  const targetWidth = Number.isFinite(declaredW) ? Math.round(declaredW as number) : 0;
  const targetHeight = Number.isFinite(declaredH) ? Math.round(declaredH as number) : 0;
  if (targetWidth <= 0 || targetHeight <= 0) return unchanged(b64);

  try {
    const input = Buffer.from(b64, 'base64');
    const metadata = await sharp(input).metadata();
    const inputWidth = metadata.width ?? 0;
    const inputHeight = metadata.height ?? 0;
    if (inputWidth <= 0 || inputHeight <= 0) return unchanged(b64);

    const targetRatio = targetWidth / targetHeight;
    const inputRatio = inputWidth / inputHeight;
    const ratioDeviation = Math.abs(inputRatio / targetRatio - 1);

    let cropWidth = inputWidth;
    let cropHeight = inputHeight;
    let left = 0;
    let top = 0;
    let needsCrop = false;

    if (ratioDeviation > ASPECT_RATIO_TOLERANCE) {
      if (inputRatio > targetRatio) {
        cropWidth = Math.max(1, Math.round(inputHeight * targetRatio));
        left = Math.floor((inputWidth - cropWidth) / 2);
      } else {
        cropHeight = Math.max(1, Math.round(inputWidth / targetRatio));
        top = Math.floor((inputHeight - cropHeight) / 2);
      }

      const retainedArea = (cropWidth * cropHeight) / (inputWidth * inputHeight);
      if (1 - retainedArea > MAX_CROP_AREA_LOSS) {
        return unchanged(b64, inputWidth, inputHeight);
      }
      needsCrop = cropWidth !== inputWidth || cropHeight !== inputHeight;
    }

    const needsResize = cropWidth !== targetWidth || cropHeight !== targetHeight;
    const maxScale = Math.max(targetWidth / cropWidth, targetHeight / cropHeight);
    const mayResize = needsResize && maxScale <= MAX_UPSCALE_FACTOR;
    const needsPngEncoding = metadata.format !== 'png';

    if (!needsCrop && !mayResize && !needsPngEncoding) {
      return unchanged(b64, inputWidth, inputHeight);
    }

    let pipeline = sharp(input);
    if (needsCrop) {
      pipeline = pipeline.extract({ left, top, width: cropWidth, height: cropHeight });
    }
    if (mayResize) {
      pipeline = pipeline.resize(targetWidth, targetHeight, { fit: 'fill' });
    }

    const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
    return {
      b64: data.toString('base64'),
      width: info.width,
      height: info.height,
      adjusted: true,
    };
  } catch {
    return unchanged(b64);
  }
}

/**
 * 把身份锚肖像压小之后再推给客户端。
 *
 * 锚图只是身份参考：客户端拿到后会在后续每一张请求里回传，而服务端收到时本来就会
 * 归一化成 1434x1920 JPEG（见 lib/reference-image-normalizer）。原样推送等于让客户端
 * 白下载一条 2.9MB 的 `data:` 行（0731 线上实测值），且它落地后还要自己再压一遍。
 * 这里提前做同一件事：下行少 ~2.6MB，SSE 上也少一条巨行——大 data: 行会让客户端的
 * 事件看门狗在下载期间收不到完整事件（见 app/task/[id]/page.tsx 的 buffer 复位注释）。
 *
 * 同样是 fail-open：任何异常都返回原图，绝不影响出图链路。
 */
export async function shrinkAnchorForClient(
  b64: string,
): Promise<{ data: string; mimeType: string }> {
  try {
    const input = Buffer.from(b64, 'base64');
    const out = await sharp(input)
      .resize({ height: 1920, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    // 反而变大就不换（本来就很小的锚没必要重编码）
    if (out.length >= input.length) return { data: b64, mimeType: 'image/png' };
    return { data: out.toString('base64'), mimeType: 'image/jpeg' };
  } catch {
    return { data: b64, mimeType: 'image/png' };
  }
}
