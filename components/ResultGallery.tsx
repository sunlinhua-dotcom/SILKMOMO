'use client';

import { useState } from 'react';
import { Download, RefreshCw, Loader, Expand, Wand2, X, Check, RotateCcw } from 'lucide-react';
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
  backup?: {
    id: number;
    data: string;
  };
}

interface ResultGalleryProps {
  images: ResultImage[];
  onRegenerate?: (imageId: number, customPrompt?: string) => void;
  onAcceptNewVersion?: (imageId: number) => void;
  onRejectNewVersion?: (imageId: number) => void;
}

const IMAGE_LABELS: Record<string, string> = {
  hero: '头图',
  full_body: '全身照',
  half_body: '半身照',
  close_up: '特写'
};

const IMAGE_TYPE_ORDER = ['hero', 'full_body', 'half_body', 'close_up'];

// 不同 imageType 实际生成尺寸不同，用对应的 aspect-ratio 避免 object-cover 切边
function aspectClassFor(imageType: ResultImage['imageType']): string {
  if (imageType === 'full_body' || imageType === 'half_body') return 'aspect-[3/4]'; // 竖图
  if (imageType === 'hero') return 'aspect-video';                                    // 16:9 场景图
  return 'aspect-square';                                                             // close_up 特写
}

export function ResultGallery({
  images,
  onRegenerate,
  onAcceptNewVersion,
  onRejectNewVersion
}: ResultGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<ResultImage | null>(null);
  const [regenerating, setRegenerating] = useState<Set<number>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);
  // 哪张图正在弹"调整描述"输入框
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [adjustText, setAdjustText] = useState('');

  const handleDownload = (image: ResultImage) => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${image.data}`;
    link.download = `silxine-${image.imageType}-${image.index || 1}.png`;
    link.click();
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      // 同 shotIndex 的新旧版本会生成相同文件名，JSZip 同名后写覆盖先写 → 静默丢图。
      // 重名时追加图片 id 保证唯一。
      const usedNames = new Set<string>();
      images.forEach((img) => {
        const imageData = atob(img.data);
        const array = new Uint8Array(imageData.length);
        for (let i = 0; i < imageData.length; i++) {
          array[i] = imageData.charCodeAt(i);
        }
        let name = `silxine-${img.imageType}-${img.index || 1}.png`;
        if (usedNames.has(name)) {
          name = `silxine-${img.imageType}-${img.index || 1}-${img.id}.png`;
        }
        usedNames.add(name);
        zip.file(name, array);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'silxine-images.zip');
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleRegenerate = async (image: ResultImage, customPrompt?: string) => {
    if (!onRegenerate) return;
    setRegenerating(prev => new Set(prev).add(image.id));
    setAdjustingId(null);
    setAdjustText('');
    try {
      await onRegenerate(image.id, customPrompt);
    } finally {
      setRegenerating(prev => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });
    }
  };

  // 微调输入面板（对比行与网格卡片共用同一套逻辑）
  const renderAdjustPanel = (image: ResultImage, variant: 'row' | 'tile') => (
    <div
      className={
        variant === 'tile'
          ? 'absolute inset-x-3 bottom-3 bg-white rounded-2xl shadow-2xl p-3 z-30'
          : 'bg-[var(--color-background)] rounded-xl p-3'
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">描述要调整什么</p>
        <button
          onClick={(e) => { e.stopPropagation(); setAdjustingId(null); setAdjustText(''); }}
          className="w-5 h-5 rounded hover:bg-[var(--color-background)] flex items-center justify-center"
        >
          <X className="w-3 h-3 text-[var(--color-text-muted)]" />
        </button>
      </div>
      <textarea
        value={adjustText}
        onChange={(e) => setAdjustText(e.target.value)}
        autoFocus
        rows={variant === 'tile' ? 3 : 2}
        placeholder="例：模特表情更柔和、整体提亮、背景改成米色窗帘"
        maxLength={500}
        className="w-full text-xs px-2.5 py-1.5 border border-[var(--color-border-light)] rounded-lg focus:outline-none focus:border-[var(--color-accent)] resize-none text-[var(--color-text)] bg-white"
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-[var(--color-text-muted)]">{adjustText.length}/500</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const text = adjustText.trim();
            if (!text) return;
            handleRegenerate(image, text);
          }}
          disabled={!adjustText.trim() || regenerating.has(image.id)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-dark)] disabled:bg-[var(--color-border-light)] disabled:text-[var(--color-text-muted)] transition-colors"
        >
          按描述重做
        </button>
      </div>
    </div>
  );

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
          className="btn-primary text-sm px-5 py-2.5"
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

        // 有旧版备份的图 → 整行「旧版 | 新版 | 右侧面板」对比；其余 → 常规网格
        const comparing = typeImages.filter(img => !!img.backup);
        const normal = typeImages.filter(img => !img.backup);

        return (
          <div key={type} className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              {IMAGE_LABELS[type]}
            </h3>

            {/* ═══ 对比行：旧版 ｜ 新版（在右）｜ 右侧操作面板 ═══ */}
            {comparing.map((image) => {
              const aspectClass = aspectClassFor(image.imageType);
              const isRegen = regenerating.has(image.id);
              const isAdjusting = adjustingId === image.id;

              return (
                <div
                  key={image.id}
                  className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-surface)] p-3 sm:p-4 space-y-3 animate-fade-in"
                >
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    {/* 旧版 */}
                    <div className="relative flex-1 min-w-0">
                      <span className="absolute top-2 left-2 z-10 px-2 py-0.5 text-[11px] font-medium bg-white/90 backdrop-blur-sm rounded-full text-[var(--color-text-secondary)] shadow-sm">
                        旧版
                      </span>
                      <div
                        className={`${aspectClass} rounded-xl overflow-hidden bg-[var(--color-background)] cursor-pointer`}
                        onClick={() => setSelectedImage({ ...image, data: image.backup!.data })}
                      >
                        <img
                          src={`data:image/png;base64,${image.backup!.data}`}
                          alt="旧版"
                          className="w-full h-full object-contain"
                        />
                      </div>
                    </div>

                    {/* 新版（在右） */}
                    <div className="relative flex-1 min-w-0">
                      <span className="absolute top-2 left-2 z-10 px-2 py-0.5 text-[11px] font-medium bg-[var(--color-accent)] rounded-full text-white shadow-sm">
                        新版
                      </span>
                      <div
                        className={`relative ${aspectClass} rounded-xl overflow-hidden bg-[var(--color-background)] cursor-pointer`}
                        onClick={() => { if (!isRegen) setSelectedImage(image); }}
                      >
                        <img
                          src={`data:image/png;base64,${image.data}`}
                          alt="新版"
                          className="w-full h-full object-contain"
                        />
                        {isRegen && (
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-20 animate-fade-in">
                            <Loader className="w-8 h-8 text-white animate-spin" strokeWidth={1.5} />
                            <span className="text-xs text-white font-medium tracking-wide">重做中…</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 右侧操作面板 */}
                    <div className="flex flex-row flex-wrap sm:flex-col gap-2 sm:w-44 flex-shrink-0">
                      <button
                        onClick={() => handleDownload(image)}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--color-border-light)] bg-white text-[var(--color-text)] hover:bg-[var(--color-accent)] hover:text-white hover:border-transparent transition-colors"
                      >
                        <Download className="w-4 h-4" strokeWidth={1.5} />
                        下载新版
                      </button>
                      {onRegenerate && (
                        <>
                          <button
                            onClick={() => handleRegenerate(image)}
                            disabled={isRegen}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--color-border-light)] bg-white text-[var(--color-text)] hover:bg-[var(--color-accent)] hover:text-white hover:border-transparent transition-colors disabled:opacity-50"
                          >
                            {isRegen ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" strokeWidth={1.5} />}
                            重新生成
                          </button>
                          <button
                            onClick={() => { setAdjustingId(image.id); setAdjustText(''); }}
                            disabled={isRegen}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--color-border-light)] bg-white text-[var(--color-text)] hover:bg-[var(--color-accent)] hover:text-white hover:border-transparent transition-colors disabled:opacity-50"
                          >
                            <Wand2 className="w-4 h-4" strokeWidth={1.5} />
                            微调描述
                          </button>
                        </>
                      )}
                      <div className="hidden sm:block h-px bg-[var(--color-border-light)] my-1" />
                      <button
                        onClick={() => onRejectNewVersion?.(image.id)}
                        disabled={isRegen}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
                        还原旧版
                      </button>
                      <button
                        onClick={() => onAcceptNewVersion?.(image.id)}
                        disabled={isRegen}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-dark)] transition-colors disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" strokeWidth={1.5} />
                        保留新版
                      </button>
                    </div>
                  </div>

                  {/* 微调描述输入 */}
                  {isAdjusting && renderAdjustPanel(image, 'row')}
                </div>
              );
            })}

            {/* ═══ 常规网格（无旧版对比） ═══ */}
            {normal.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {normal.map((image) => {
                  const aspectClass = aspectClassFor(image.imageType);
                  const isRegen = regenerating.has(image.id);
                  const isAdjusting = adjustingId === image.id;

                  return (
                    <div
                      key={image.id}
                      className={`group relative ${aspectClass} rounded-2xl overflow-hidden bg-[var(--color-background)] cursor-pointer hover-lift`}
                      onClick={() => { if (!isAdjusting) setSelectedImage(image); }}
                    >
                      <img
                        src={`data:image/png;base64,${image.data}`}
                        alt={IMAGE_LABELS[image.imageType]}
                        className="w-full h-full object-contain"
                      />

                      {/* 重做中遮罩 */}
                      {isRegen && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 z-20 animate-fade-in">
                          <Loader className="w-10 h-10 text-white animate-spin" strokeWidth={1.5} />
                          <span className="text-sm text-white font-medium tracking-wide">重做中…</span>
                          <span className="text-[10px] text-white/70">完成后将自动替换</span>
                        </div>
                      )}

                      {/* 悬浮操作栏 —— 不悬停时 pointer-events-none，避免透明层拦截点击 */}
                      <div className={`absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent transition-opacity flex items-end justify-center pb-4 gap-2 z-20 ${adjustingId === image.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'}`}>
                        <div className="relative group/tip">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(image);
                            }}
                            className="w-11 h-11 flex items-center justify-center bg-white rounded-full shadow-lg hover:bg-[var(--color-accent)] hover:text-white transition-colors"
                            aria-label="下载图片"
                          >
                            <Download className="w-5 h-5" strokeWidth={1.5} />
                          </button>
                          <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] px-2.5 py-1 rounded-md bg-black/85 text-white opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-10">下载</span>
                        </div>
                        {onRegenerate && (
                          <>
                            <div className="relative group/tip">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRegenerate(image);
                                }}
                                disabled={isRegen}
                                className="w-11 h-11 flex items-center justify-center bg-white rounded-full shadow-lg hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-50"
                                aria-label="重新生成（用相同参数）"
                              >
                                {isRegen ? (
                                  <Loader className="w-5 h-5 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-5 h-5" strokeWidth={1.5} />
                                )}
                              </button>
                              <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] px-2.5 py-1 rounded-md bg-black/85 text-white opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-10">重新生成</span>
                            </div>
                            <div className="relative group/tip">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAdjustingId(image.id);
                                  setAdjustText('');
                                }}
                                disabled={isRegen}
                                className="w-11 h-11 flex items-center justify-center bg-white rounded-full shadow-lg hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-50"
                                aria-label="描述要调整什么"
                              >
                                <Wand2 className="w-5 h-5" strokeWidth={1.5} />
                              </button>
                              <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] px-2.5 py-1 rounded-md bg-black/85 text-white opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-10">微调描述</span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* 图片标签 */}
                      <div className="absolute top-3 left-3">
                        <span className="px-2.5 py-1 text-xs font-medium bg-white/90 backdrop-blur-sm rounded-full text-[var(--color-text)] shadow-sm">
                          {IMAGE_LABELS[image.imageType]}
                        </span>
                      </div>

                      {/* "描述调整"输入面板 */}
                      {isAdjusting && renderAdjustPanel(image, 'tile')}
                    </div>
                  );
                })}
              </div>
            )}
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
