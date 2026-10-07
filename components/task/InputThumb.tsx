'use client';

import type { ImageItem } from '@/lib/db';

interface InputThumbProps {
  image: ImageItem;
  /** 缩略图下方的文字，同时作为 alt */
  label: string;
  /** 描边 / 透明度等差异化样式 */
  className?: string;
  onPreview: (src: string, label: string) => void;
}

/** 任务页「输入图片」里的一张可点击放大的缩略图（原先同一段 JSX 复制了五遍）。 */
export function InputThumb({ image, label, className = '', onPreview }: InputThumbProps) {
  const src = `data:${image.mimeType};base64,${image.data}`;
  return (
    <div className="flex-shrink-0">
      <button
        type="button"
        onClick={() => onPreview(src, label)}
        aria-label={`放大查看：${label}`}
        className={`block h-20 w-20 cursor-zoom-in overflow-hidden rounded-xl shadow-sm transition-transform hover:scale-105 ${className}`}
      >
        {/* 来源是 IndexedDB 里的 base64 data URI，next/image 优化不了，这里有意用原生 img */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} width={80} height={80} className="h-full w-full object-cover" />
      </button>
      <p className="mt-1 text-center text-[10px] text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}
