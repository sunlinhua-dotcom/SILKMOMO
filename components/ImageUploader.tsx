'use client';

import { Upload, X, Sparkles, FolderOpen, ImageIcon, AlertTriangle } from 'lucide-react';
import { compressImage, MAX_COMPRESSED_IMAGE_BYTES, type CompressedImage } from '@/lib/image-compressor';
import { countLibraryImages, saveToLibrary } from '@/lib/image-library';
import { isStorageQuotaError, STORAGE_FULL_MESSAGE } from '@/lib/db';
import { useToast } from '@/components/ui/Toast';
import { ImageLibraryPicker } from './ImageLibraryPicker';
import { useState, useRef, useEffect, useCallback, useId } from 'react';
import Image from 'next/image';

interface UploadNotice {
  kind: 'warn' | 'error';
  text: string;
}

// 预览列表的稳定 key：压缩结果没有 id，按对象身份分配（父级保留同一对象时 key 不变，删除中间一张不会让后面的图重挂载）
const imageKeys = new WeakMap<object, string>();
let imageKeySeq = 0;
function imageKeyOf(image: CompressedImage): string {
  let key = imageKeys.get(image);
  if (!key) {
    key = `up_${++imageKeySeq}`;
    imageKeys.set(image, key);
  }
  return key;
}

interface ImageUploaderProps {
  title: string;
  description: string;
  required?: boolean;
  maxFiles?: number;
  images: CompressedImage[];
  onImagesChange: (images: CompressedImage[]) => void;
  variant?: 'gold' | 'gray' | 'dashed';
}

export function ImageUploader({
  title,
  description,
  required = false,
  maxFiles = 3,
  images,
  onImagesChange,
  variant = 'gray',
}: ImageUploaderProps) {
  const getCategoryFromTitle = (t: string) => {
    const titleLower = t.toLowerCase();
    if (titleLower.includes('产品') || titleLower.includes('product')) return 'product' as const;
    if (titleLower.includes('模特') || titleLower.includes('model')) return 'model_ref' as const;
    // "风格" 走背景参考（风格包应用到的也是 bg_ref / scene_ref，背景是更通用的归属）
    if (titleLower.includes('背景') || titleLower.includes('bg') || titleLower.includes('风格') || titleLower.includes('style')) return 'bg_ref' as const;
    if (titleLower.includes('场景') || titleLower.includes('scene')) return 'scene_ref' as const;
    if (titleLower.includes('配件') || titleLower.includes('accessory') || titleLower.includes('accessories')) return 'accessory' as const;
    return undefined;
  };
  const category = getCategoryFromTitle(title);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [notice, setNotice] = useState<UploadNotice | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const toast = useToast();
  const hintId = useId();
  const noticeId = useId();

  // 异步流程里要读「最新」的 images / maxFiles，避免 await 期间父级已变化导致覆盖
  const imagesRef = useRef(images);
  const maxFilesRef = useRef(maxFiles);
  useEffect(() => {
    imagesRef.current = images;
    maxFilesRef.current = maxFiles;
  });

  // 图库中有图片数量（用于显示按钮提示）— 客户端加载避免 hydration mismatch。
  // 只做 count()，不把整库 base64 读出来。
  const [libraryCount, setLibraryCount] = useState(0);
  const refreshLibraryCount = useCallback(() => {
    countLibraryImages()
      .then(n => setLibraryCount(n))
      .catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    countLibraryImages()
      .then(n => { if (!cancelled) setLibraryCount(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [images.length]);

  const reportNotice = (next: UploadNotice) => {
    setNotice(next);
    if (next.kind === 'error') toast.error(next.text);
    else toast.info(next.text);
  };

  const handleFileSelect = async (files: FileList | null, inputEl?: HTMLInputElement | null) => {
    // 先把 FileList 复制成数组，再重置 input 的 value：
    // - 不重置 value：删除图片后再选同一个文件，浏览器不触发 change，上传无反应
    // - 先重置后读取：部分浏览器的 FileList 是活引用，重置会把它同步清空
    const fileArray = files ? Array.from(files) : [];
    if (inputEl) inputEl.value = '';
    if (fileArray.length === 0) return;

    setNotice(null);

    const imageFiles = fileArray.filter(f =>
      f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name)
    );
    const nonImageCount = fileArray.length - imageFiles.length;

    const remainingSlots = Math.max(0, maxFilesRef.current - imagesRef.current.length);
    const filesToProcess = imageFiles.slice(0, remainingSlots);
    const overflowCount = imageFiles.length - filesToProcess.length;

    const problems: string[] = [];
    let compressFailed = 0;
    let added: CompressedImage[] = [];

    if (filesToProcess.length > 0) {
      setIsProcessing(true);
      try {
        const results = await Promise.allSettled(filesToProcess.map(file => compressImage(file)));
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.size <= MAX_COMPRESSED_IMAGE_BYTES) {
            added.push(r.value);
          } else {
            compressFailed += 1;
            console.error(
              '图片压缩失败:',
              r.status === 'rejected' ? r.reason : '压缩后仍超过 800KiB 安全上限',
            );
          }
        }
        // 重新按最新状态截取，防止 await 期间名额已被占用
        const room = Math.max(0, maxFilesRef.current - imagesRef.current.length);
        const dropped = Math.max(0, added.length - room);
        if (dropped > 0) {
          added = added.slice(0, room);
        }
        if (added.length > 0) {
          onImagesChange([...imagesRef.current, ...added]);
        }
        if (dropped > 0) problems.push(`${dropped} 张超出上限 ${maxFilesRef.current} 张未添加`);
      } finally {
        setIsProcessing(false);
      }
    }

    if (compressFailed > 0) problems.push(`${compressFailed} 张压缩失败`);
    if (overflowCount > 0) problems.push(`${overflowCount} 张超出上限 ${maxFilesRef.current} 张未添加`);
    if (nonImageCount > 0) problems.push(`${nonImageCount} 个文件不是图片，已忽略`);

    // 自动保存到图库；配额写满要明确告诉用户（上传本身已经成功）
    let quotaFull = false;
    if (added.length > 0) {
      try {
        await saveToLibrary(added, category);
        refreshLibraryCount();
      } catch (e) {
        if (isStorageQuotaError(e)) quotaFull = true;
        else console.warn('图库保存失败:', e);
      }
    }

    if (quotaFull) {
      problems.push(STORAGE_FULL_MESSAGE);
    }
    if (problems.length > 0) {
      const prefix = added.length > 0 ? `已添加 ${added.length} 张；` : '';
      reportNotice({
        kind: added.length > 0 && !quotaFull ? 'warn' : 'error',
        text: `${prefix}${problems.join('；')}`,
      });
    }
  };

  const handleLibrarySelect = (selectedImages: CompressedImage[]) => {
    const remainingSlots = Math.max(0, maxFiles - images.length);
    const toAdd = selectedImages.slice(0, remainingSlots);
    setNotice(null);
    onImagesChange([...images, ...toAdd]);
  };

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 拖过子元素会连续触发 enter/leave，用计数避免高亮闪烁
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };

  const openFilePicker = () => {
    if (!isProcessing) fileInputRef.current?.click();
  };

  const removeImage = (index: number) => {
    setNotice(null);
    onImagesChange(images.filter((_, i) => i !== index));
  };

  const cardVariant = {
    gold: 'upload-card-gold',
    gray: 'upload-card-gray',
    dashed: 'upload-card-dashed',
  }[variant];

  const iconGradient = {
    gold: 'from-[var(--color-brand)] to-[var(--color-accent-light)]',
    gray: 'from-[var(--color-muted)] to-[var(--color-text-secondary)]',
    dashed: 'from-[var(--color-brand)] to-[var(--color-accent-light)]',
  }[variant];

  const slotsLeft = Math.max(0, maxFiles - images.length);
  const describedBy = notice ? `${hintId} ${noticeId}` : hintId;

  return (
    <>
      <div className={`upload-card ${cardVariant} min-w-0 p-4 sm:p-6`}>
        {/* 标题栏 */}
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-2 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--color-text)] sm:text-lg">
              {title}
            </h3>
            {required && (
              <span className="text-sm text-[var(--color-brand-strong)]" aria-label="必填">*</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 图库按钮 */}
            {libraryCount > 0 && images.length < maxFiles && (
              <button
                type="button"
                onClick={() => setShowLibrary(true)}
                className="flex min-h-8 items-center gap-1 rounded-full border border-[var(--color-brand-strong)]/30 bg-[var(--color-brand-soft)] px-2.5 py-1 text-[11px] text-[var(--color-brand-strong)] transition-all hover:bg-[var(--color-brand-soft)]/70"
              >
                <ImageIcon className="h-3 w-3" aria-hidden="true" />
                图库 <span className="num">{libraryCount}</span>
              </button>
            )}
            <span className={`count-badge ${images.length > 0 ? 'active' : ''}`}>
              {images.length}/{maxFiles}
            </span>
          </div>
        </div>

        {/* 描述 */}
        <p className="-mt-1 mb-3 text-xs text-[var(--color-text-secondary)] sm:text-sm">
          {description}
        </p>

        {/* 上传区域：整块可拖拽 / 点击；键盘用里面的主按钮（Enter / Space）打开文件选择 */}
        {images.length < maxFiles && (
          <div
            className={`upload-zone ${isDragging ? 'dragging' : ''} group`}
            onClick={openFilePicker}
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {isProcessing ? (
              <div role="status" className="flex flex-col items-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent-light)]">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                </div>
                <p className="text-sm font-medium text-[var(--color-text)]">处理中…</p>
              </div>
            ) : (
              <>
                <div className={`upload-zone-icon bg-gradient-to-br ${iconGradient}`}>
                  <Upload className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <button
                  type="button"
                  aria-describedby={describedBy}
                  className="mb-1 rounded-md px-2 text-center text-sm font-medium text-[var(--color-text)]"
                >
                  {isDragging ? '松开以上传' : '点击选择或拖拽图片'}
                </button>
                <p id={hintId} className="mb-2 text-center text-[11px] text-[var(--color-text-muted)]">
                  JPG · PNG · WebP · 支持多选 · 最多 {maxFiles} 张，还可添加 {slotsLeft} 张
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {/* 文件夹上传 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                    className="flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-brand-strong)] hover:text-[var(--color-primary)]"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    文件夹
                  </button>
                  {/* 从图库选择 */}
                  {libraryCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowLibrary(true);
                      }}
                      className="flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-brand-strong)]/30 bg-[var(--color-brand-soft)] px-3 py-1.5 text-[11px] text-[var(--color-brand-strong)] transition-all hover:bg-[var(--color-brand-soft)]/70"
                    >
                      <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      图库选择
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* 共用的隐藏文件 input（上传区与「添加」格都用它） */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          tabIndex={-1}
          accept="image/*"
          multiple
          aria-hidden="true"
          onChange={(e) => handleFileSelect(e.target.files, e.target)}
        />

        {/* 隐藏的文件夹 input */}
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          tabIndex={-1}
          accept="image/*"
          multiple
          aria-hidden="true"
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => handleFileSelect(e.target.files, e.target)}
        />

        {/* 失败 / 被丢弃 / 存储已满的内联提示（toast 会消失，这里保留到下一次操作） */}
        {notice && (
          <div
            id={noticeId}
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
              notice.kind === 'error'
                ? 'border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
                : 'border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
            }`}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 break-words">{notice.text}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="关闭提示"
              className="-m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* 图片预览 */}
        {images.length > 0 && (
          <div className="image-grid">
            {images.map((image, index) => (
              <div key={imageKeyOf(image)} className="image-thumb">
                <Image
                  src={image.dataUrl}
                  alt={`${title} ${index + 1}`}
                  className="h-full w-full object-cover"
                  width={200}
                  height={200}
                  unoptimized
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-ink)]/80 text-white transition-colors hover:bg-[var(--color-danger)]"
                  aria-label={`删除${title}第 ${index + 1} 张`}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                  <p className="text-center text-[10px] font-medium text-white">
                    {Math.round(image.size / 1024)}KB
                  </p>
                </div>
              </div>
            ))}
            {images.length < maxFiles && (
              <button
                type="button"
                onClick={openFilePicker}
                disabled={isProcessing}
                aria-label={`添加${title}图片`}
                className="image-thumb flex cursor-pointer items-center justify-center border-2 border-dashed border-[var(--color-border)] bg-[var(--color-background)] transition-colors hover:border-[var(--color-brand-strong)] disabled:cursor-wait disabled:opacity-60"
              >
                <span className="text-center">
                  <span className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-accent-light)]">
                    <Sparkles className="h-4 w-4 text-white" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="text-[10px] text-[var(--color-text-secondary)]">
                    添加
                  </span>
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 图库弹窗 */}
      <ImageLibraryPicker
        isOpen={showLibrary}
        onClose={() => { setShowLibrary(false); refreshLibraryCount(); }}
        onSelect={handleLibrarySelect}
        maxSelect={maxFiles}
        currentCount={images.length}
        category={category}
      />
    </>
  );
}
