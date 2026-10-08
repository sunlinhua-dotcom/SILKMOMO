'use client';

import type { ReactNode } from 'react';
import type { ImageItem } from '@/lib/db';
import { InputThumb } from './InputThumb';

/** 「输入图片」概览卡：产品 / 模特参考 / 背景参考 / 场景参考 / 配件缩略图 + 下方参数芯片（children）。 */
export function InputImagesCard({
  inputImages,
  onPreview,
  children,
}: {
  inputImages: {
    products: ImageItem[];
    modelRefs: ImageItem[];
    bgRefs: ImageItem[];
    sceneRefs: ImageItem[];
    accessories: ImageItem[];
  };
  onPreview: (src: string, label: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="mb-10 bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
      <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        输入图片
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {inputImages.products.map(img => (
          <InputThumb
            key={img.id}
            image={img}
            label="产品"
            className="border-2 border-[var(--color-accent)]"
            onPreview={onPreview}
          />
        ))}
        {inputImages.modelRefs.map(img => (
          <InputThumb
            key={img.id}
            image={img}
            label="模特参考"
            className="border border-[var(--color-secondary)]"
            onPreview={onPreview}
          />
        ))}
        {inputImages.bgRefs.map(img => (
          <InputThumb
            key={img.id}
            image={img}
            label="背景参考"
            className="border border-[var(--color-border)] opacity-80 hover:opacity-100"
            onPreview={onPreview}
          />
        ))}
        {inputImages.sceneRefs.map(img => (
          <InputThumb
            key={img.id}
            image={img}
            label="场景参考"
            className="border border-[var(--color-success)]/50 opacity-80 hover:opacity-100"
            onPreview={onPreview}
          />
        ))}
        {inputImages.accessories.map(img => (
          <InputThumb
            key={img.id}
            image={img}
            label="配件"
            className="border border-dashed border-[var(--color-border)] opacity-60 hover:opacity-100"
            onPreview={onPreview}
          />
        ))}
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}
