/**
 * 图片压缩工具
 * 压缩图片到指定尺寸以下，保证上传速度
 */

const MAX_WIDTH = 2048;
const MAX_SIZE_MB = 3;
const QUALITY = 0.85;

export interface CompressedImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}

export async function compressImage(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // 计算新尺寸
        let { width, height } = img;
        const maxSize = Math.max(width, height);

        if (maxSize > MAX_WIDTH) {
          if (width > height) {
            width = MAX_WIDTH;
            height = (height * MAX_WIDTH) / maxSize;
          } else {
            height = MAX_WIDTH;
            width = (width * MAX_WIDTH) / maxSize;
          }
        }

        // 创建 canvas 进行压缩
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // 转换为 base64
        const mimeType = file.type || 'image/jpeg';
        let quality = QUALITY;
        let dataUrl = canvas.toDataURL(mimeType, quality);

        // 如果文件太大，降低质量
        while (dataUrl.length > MAX_SIZE_MB * 1024 * 1024 * 1.37 && quality > 0.5) {
          quality -= 0.05;
          dataUrl = canvas.toDataURL(mimeType, quality);
        }

        const base64 = dataUrl.split(',')[1];

        resolve({
          dataUrl,
          base64,
          mimeType,
          size: Math.round(dataUrl.length / 1.37),
          width: Math.round(width),
          height: Math.round(height)
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
