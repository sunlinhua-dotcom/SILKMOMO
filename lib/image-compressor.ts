/**
 * 图片压缩工具 — 优化版
 * 1. 优先输出 WebP 格式（体积比 JPEG 小 25-35%）
 * 2. 渐进式质量降低确保在目标大小内
 * 3. 使用 createImageBitmap 替代 new Image（更快、不阻塞主线程）
 * 4. 小图直接通过不压缩
 */

const MAX_DIMENSION = 1920;   // 最大边长（AI生成不需要超高清原图）
const TARGET_SIZE_KB = 800;   // 目标文件大小 800KB
const MAX_SIZE_KB = 1500;     // 绝对上限 1.5MB
const INITIAL_QUALITY = 0.82;
const MIN_QUALITY = 0.45;
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

/**
 * 检测浏览器是否支持 WebP 编码
 */
let _webpSupported: boolean | null = null;
function supportsWebP(): boolean {
  if (_webpSupported !== null) return _webpSupported;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    _webpSupported = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    _webpSupported = false;
  }
  return _webpSupported;
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

  // 选择输出格式：优先 WebP
  const outputMime = supportsWebP() ? 'image/webp' : 'image/jpeg';

  // 渐进式质量压缩
  let quality = INITIAL_QUALITY;
  let dataUrl = canvas.toDataURL(outputMime, quality);
  let estimatedSize = Math.round(dataUrl.length * 0.75); // base64 → bytes

  while (estimatedSize > TARGET_SIZE_KB * 1024 && quality > MIN_QUALITY) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL(outputMime, quality);
    estimatedSize = Math.round(dataUrl.length * 0.75);
  }

  // 如果还是太大，最终尝试
  if (estimatedSize > MAX_SIZE_KB * 1024) {
    dataUrl = canvas.toDataURL(outputMime, MIN_QUALITY);
    estimatedSize = Math.round(dataUrl.length * 0.75);
  }

  const base64 = dataUrl.split(',')[1];

  return {
    dataUrl,
    base64,
    mimeType: outputMime,
    size: estimatedSize,
    width,
    height,
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

        const outputMime = supportsWebP() ? 'image/webp' : 'image/jpeg';
        let quality = INITIAL_QUALITY;
        let dataUrl = canvas.toDataURL(outputMime, quality);
        let estimatedSize = Math.round(dataUrl.length * 0.75);

        while (estimatedSize > TARGET_SIZE_KB * 1024 && quality > MIN_QUALITY) {
          quality -= 0.08;
          dataUrl = canvas.toDataURL(outputMime, quality);
          estimatedSize = Math.round(dataUrl.length * 0.75);
        }

        resolve({
          dataUrl,
          base64: dataUrl.split(',')[1],
          mimeType: outputMime,
          size: estimatedSize,
          width,
          height,
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
