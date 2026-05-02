'use client';

import { useState } from 'react';
import { Download, RefreshCw, Loader, Expand } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ImageLightbox } from './ImageLightbox';

interface ResultImage {
  id: number;
  type: string;
  imageType: 'hero' | 'full_body' | 'half_body' | 'close_up';
  data: string;
  prompt?: string;
  index?: number;
}

interface ResultGalleryProps {
  images: ResultImage[];
  onRegenerate?: (imageId: number, customPrompt?: string) => void;
}

const IMAGE_LABELS: Record<string, string> = {
  hero: '头图',
  full_body: '全身照',
  half_body: '半身照',
  close_up: '特写'
};

const IMAGE_TYPE_ORDER = ['hero', 'full_body', 'half_body', 'close_up'];

export function ResultGallery({ images, onRegenerate }: ResultGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<ResultImage | null>(null);
  const [regenerating, setRegenerating] = useState<Set<number>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);

  const handleDownload = (image: ResultImage) => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${image.data}`;
    link.download = `silkmomo-${image.imageType}-${image.index || 1}.png`;
    link.click();
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      images.forEach((img) => {
        const imageData = atob(img.data);
        const array = new Uint8Array(imageData.length);
        for (let i = 0; i < imageData.length; i++) {
          array[i] = imageData.charCodeAt(i);
        }
        zip.file(`silkmomo-${img.imageType}-${img.index || 1}.png`, array);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'silkmomo-images.zip');
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleRegenerate = async (image: ResultImage) => {
    if (!onRegenerate) return;
    setRegenerating(prev => new Set(prev).add(image.id));
    try {
      await onRegenerate(image.id);
    } finally {
      setRegenerating(prev => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });
    }
  };

  if (images.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 rounded-full bg-[var(--color-background)] flex items-center justify-center mx-auto mb-4">
          <Expand className="w-8 h-8 text-[var(--color-text-muted)]" />
        </div>
        <p className="text-[var(--color-text-secondary)]">暂无生成结果</p>
        <p className="text-sm text-[var(--color-text-muted)] mt-2">
          完成生成后，图片将在这里显示
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 下载按钮 */}
      <div className="flex justify-end">
        <button
          onClick={handleDownloadAll}
          disabled={downloadingAll}
          className="btn-primary"
        >
          {downloadingAll ? (
            <>
              <Loader className="w-5 h-5 animate-spin" />
              <span>打包中...</span>
            </>
          ) : (
            <>
              <Download className="w-5 h-5" strokeWidth={1.5} />
              <span>下载全部 ({images.length}张)</span>
            </>
          )}
        </button>
      </div>

      {/* 图片分组展示 */}
      {IMAGE_TYPE_ORDER.map((type) => {
        const typeImages = images.filter(img => img.imageType === type);
        if (typeImages.length === 0) return null;

        return (
          <div key={type} className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              {IMAGE_LABELS[type]}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {typeImages.map((image) => {
                // 全身照/半身照默认 3:4 竖图，object-cover 会切掉头/脚；用 contain 保留完整内容
                const isPortrait = image.imageType === 'full_body' || image.imageType === 'half_body';
                return (
                <div
                  key={image.id}
                  className={`group relative ${isPortrait ? 'aspect-[3/4]' : 'aspect-square'} rounded-2xl overflow-hidden bg-[var(--color-background)] cursor-pointer hover-lift`}
                  onClick={() => setSelectedImage(image)}
                >
                  <img
                    src={`data:image/png;base64,${image.data}`}
                    alt={IMAGE_LABELS[image.imageType]}
                    className="w-full h-full object-contain"
                  />

                  {/* 悬浮操作栏 */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4 gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(image);
                      }}
                      className="w-11 h-11 flex items-center justify-center bg-white rounded-full shadow-lg hover:bg-[var(--color-accent)] hover:text-white transition-colors"
                      title="下载"
                    >
                      <Download className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                    {onRegenerate && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRegenerate(image);
                        }}
                        disabled={regenerating.has(image.id)}
                        className="w-11 h-11 flex items-center justify-center bg-white rounded-full shadow-lg hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-50"
                        title="重新生成"
                      >
                        {regenerating.has(image.id) ? (
                          <Loader className="w-5 h-5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-5 h-5" strokeWidth={1.5} />
                        )}
                      </button>
                    )}
                  </div>

                  {/* 图片标签 */}
                  <div className="absolute top-3 left-3">
                    <span className="px-2.5 py-1 text-xs font-medium bg-white/90 backdrop-blur-sm rounded-full text-[var(--color-text)] shadow-sm">
                      {IMAGE_LABELS[image.imageType]}
                    </span>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {selectedImage && (
        <ImageLightbox
          src={`data:image/png;base64,${selectedImage.data}`}
          alt="预览"
          onClose={() => setSelectedImage(null)}
          footer={
            <button
              onClick={() => handleDownload(selectedImage)}
              className="flex items-center gap-2 px-6 py-3 bg-white text-[var(--color-text)] rounded-full font-medium hover:bg-[var(--color-accent)] hover:text-white transition-colors whitespace-nowrap"
            >
              <Download className="w-5 h-5" strokeWidth={1.5} />
              下载图片
            </button>
          }
        />
      )}
    </div>
  );
}
