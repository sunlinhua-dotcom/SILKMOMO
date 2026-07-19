/**
 * 图片压缩工具 — 优化版
 * 1. 透明图保留 PNG；不透明图使用 JPEG
 * 2. 先渐进式降低 JPEG 质量，仍超标则继续降低分辨率
 * 3. 使用 createImageBitmap 替代 new Image（更快、不阻塞主线程）
 * 4. 小图直接通过不压缩
 */

const MAX_DIMENSION = 1920;   // 最大边长（AI生成不需要超高清原图）
const TARGET_SIZE_KB = 800;   // 目标文件大小 800KB
export const MAX_COMPRESSED_IMAGE_BYTES = TARGET_SIZE_KB * 1024;
const INITIAL_QUALITY = 0.82;
const MIN_QUALITY = 0.45;
const JPEG_QUALITIES = [INITIAL_QUALITY, 0.74, 0.66, 0.58, 0.50, MIN_QUALITY] as const;
const SKIP_COMPRESS_KB = 200; // 小于 200KB 直接跳过压缩

export interface CompressedImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  originalSize: number;       // 记录原始大小，方便调试
}

function dataUrlByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

function canvasHasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas context unavailable');

  // 分条读取，避免一次为 1920px 图分配整张额外 RGBA 缓冲区。
  const STRIP_HEIGHT = 128;
  for (let y = 0; y < canvas.height; y += STRIP_HEIGHT) {
    const height = Math.min(STRIP_HEIGHT, canvas.height - y);
    const pixels = ctx.getImageData(0, y, canvas.width, height).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 255) return true;
    }
  }
  return false;
}

function resizeCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function nextDimensions(width: number, height: number, currentBytes: number): { width: number; height: number } {
  const estimatedScale = Math.sqrt(MAX_COMPRESSED_IMAGE_BYTES / currentBytes) * 0.95;
  const scale = Math.min(0.85, estimatedScale);
  const nextWidth = Math.max(1, Math.min(width - (width > 1 ? 1 : 0), Math.floor(width * scale)));
  const nextHeight = Math.max(1, Math.min(height - (height > 1 ? 1 : 0), Math.floor(height * scale)));
  return { width: nextWidth, height: nextHeight };
}

function encodeCanvasWithinLimit(initialCanvas: HTMLCanvasElement): {
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
  size: number;
  width: number;
  height: number;
} {
  const preserveTransparency = canvasHasTransparency(initialCanvas);
  const mimeType = preserveTransparency ? 'image/png' : 'image/jpeg';
  let canvas = initialCanvas;

  while (true) {
    let dataUrl = canvas.toDataURL(mimeType, preserveTransparency ? undefined : JPEG_QUALITIES[0]);
    let size = dataUrlByteLength(dataUrl);

    if (!preserveTransparency) {
      for (const quality of JPEG_QUALITIES.slice(1)) {
        if (size <= MAX_COMPRESSED_IMAGE_BYTES) break;
        dataUrl = canvas.toDataURL(mimeType, quality);
        size = dataUrlByteLength(dataUrl);
      }
    }

    if (size <= MAX_COMPRESSED_IMAGE_BYTES) {
      return { dataUrl, mimeType, size, width: canvas.width, height: canvas.height };
    }

    if (canvas.width === 1 && canvas.height === 1) {
      throw new Error('无法将图片压缩到 800KiB 安全上限');
    }
    const dimensions = nextDimensions(canvas.width, canvas.height, size);
    canvas = resizeCanvas(canvas, dimensions.width, dimensions.height);
  }
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const originalSize = file.size;

  // 小文件直接读取，不做画布压缩
  if (originalSize < SKIP_COMPRESS_KB * 1024) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          // 字节小不代表像素小：高压缩比的原图可能只有几十 KB 却是 4000px+，
          // 直接放行会让超大分辨率原图流入下游(上传/生成)。像素超限时仍走缩放路径。
          // 例外：GIF 走 canvas 会被拍平成静态首帧且 mimeType 被改写，动图丢失，
          // 故大像素 GIF 仍原样放行（≥200KB 的 GIF 早已会被主路径拍平，属既有行为，不在此处理）。
          if (file.type !== 'image/gif' && Math.max(img.width, img.height) > MAX_DIMENSION) {
            compressImageLegacy(file).then(resolve).catch(reject);
            return;
          }
          resolve({
            dataUrl,
            base64: dataUrl.split(',')[1],
            mimeType: file.type || 'image/jpeg',
            size: originalSize,
            width: img.width,
            height: img.height,
            originalSize,
          });
        };
        img.onerror = reject;
        img.src = dataUrl;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 使用 createImageBitmap 加速解码（不阻塞主线程）
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // fallback: 传统方式
    return compressImageLegacy(file);
  }

  // 计算缩放尺寸
  let { width, height } = bitmap;
  const maxSide = Math.max(width, height);

  if (maxSide > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / maxSide;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  // 创建 canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close(); // 释放内存

  const encoded = encodeCanvasWithinLimit(canvas);
  const base64 = encoded.dataUrl.split(',')[1];

  return {
    dataUrl: encoded.dataUrl,
    base64,
    mimeType: encoded.mimeType,
    size: encoded.size,
    width: encoded.width,
    height: encoded.height,
    originalSize,
  };
}

/** Legacy fallback（不支持 createImageBitmap 的浏览器） */
function compressImageLegacy(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const maxSide = Math.max(width, height);

        if (maxSide > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / maxSide;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas context unavailable')); return; }

        ctx.drawImage(img, 0, 0, width, height);

        const encoded = encodeCanvasWithinLimit(canvas);

        resolve({
          dataUrl: encoded.dataUrl,
          base64: encoded.dataUrl.split(',')[1],
          mimeType: encoded.mimeType,
          size: encoded.size,
          width: encoded.width,
          height: encoded.height,
          originalSize: file.size,
        });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressImages(files: File[]): Promise<CompressedImage[]> {
  return Promise.all(files.map(file => compressImage(file)));
}
