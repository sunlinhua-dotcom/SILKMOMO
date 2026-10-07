'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Check, ImageIcon, Trash2 } from 'lucide-react';
import { getLibraryImages, deleteLibraryImage, libraryToCompressed, type LibraryImage } from '@/lib/image-library';
import type { CompressedImage } from '@/lib/image-compressor';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

type LibraryCategory = NonNullable<LibraryImage['category']>;
type LibraryTab = 'all' | LibraryCategory;

interface ImageLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (images: CompressedImage[]) => void;
  maxSelect: number;       // 最多可选几张
  currentCount: number;    // 当前已有几张
  category?: LibraryCategory;
}

const CATEGORY_TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'product', label: '产品服装' },
  { id: 'model_ref', label: '模特妆发' },
  { id: 'bg_ref', label: '背景参考' },
  { id: 'scene_ref', label: '场景参考' },
  { id: 'accessory', label: '配件' },
];

export function ImageLibraryPicker({
  isOpen,
  onClose,
  onSelect,
  maxSelect,
  currentCount,
  category,
}: ImageLibraryPickerProps) {
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<LibraryTab>('all');
  const confirm = useConfirm();
  const toast = useToast();

  const remaining = Math.max(0, maxSelect - currentCount);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelected(new Set());
      setActiveTab(category || 'all');
    });
    getLibraryImages()
      .then(imgs => { if (!cancelled) setLibraryImages(imgs); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen, category]);

  const filteredImages = libraryImages.filter(img => {
    if (activeTab === 'all') return true;
    return img.category === activeTab;
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < remaining) {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selectedImages = libraryImages
      .filter(img => selected.has(img.id))
      .map(libraryToCompressed);
    onSelect(selectedImages);
    onClose();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: '从图库删除这张图？',
      message: '删除后无法恢复；已经用在当前任务里的图不受影响。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteLibraryImage(id);
    } catch (e) {
      console.warn('图库删除失败:', e);
      toast.error('删除失败，请稍后重试');
      return;
    }
    setLibraryImages(prev => prev.filter(img => img.id !== id));
    setSelected(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const footer = libraryImages.length > 0 ? (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
        已选 {selected.size} 张
      </span>
      <button
        type="button"
        onClick={handleConfirm}
        disabled={selected.size === 0}
        className="btn-primary !py-2 !px-6 !text-sm"
      >
        确认选择
      </button>
    </div>
  ) : undefined;

  return (
    <Modal open={isOpen} onClose={onClose} title="图库" size="lg" footer={footer}>
      <p className="-mt-1 mb-3 text-xs text-[var(--color-text-muted)]">
        选择之前上传过的图片（还可选 {Math.max(0, remaining - selected.size)} 张）
      </p>

      {/* Tab 页签分类选择 */}
      <div
        role="group"
        aria-label="图库分类"
        className="no-scrollbar -mx-1 mb-3 flex gap-1 overflow-x-auto rounded-lg bg-[var(--color-background)]/50 px-1 py-1.5"
      >
        {CATEGORY_TABS.map(tab => {
          const isTabActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={isTabActive}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-9 cursor-pointer whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs transition-colors ${
                isTabActive
                  ? 'bg-[var(--color-brand-strong)] font-medium text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-primary)]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 图片网格 */}
      {libraryImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ImageIcon className="mb-3 h-10 w-10 text-[var(--color-text-muted)]" strokeWidth={1} aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-secondary)]">图库为空</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">上传的图片会自动保存到图库</p>
        </div>
      ) : filteredImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ImageIcon className="mb-3 h-10 w-10 text-[var(--color-text-muted)] opacity-60" strokeWidth={1} aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-secondary)]">该分类下暂无图片</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">可切换至其他分类页签查看</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-2.5 p-1 sm:grid-cols-4">
          {filteredImages.map((img, i) => {
            const isSelected = selected.has(img.id);
            const isDisabled = !isSelected && selected.size >= remaining;
            return (
              <li
                key={img.id}
                className={`group relative aspect-square overflow-hidden rounded-xl ring-2 transition-all duration-200 ${
                  isSelected
                    ? 'scale-[0.96] ring-[var(--color-brand-strong)]'
                    : 'ring-transparent hover:ring-[var(--color-border)]'
                } ${isDisabled ? 'opacity-40' : ''}`}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-disabled={isDisabled}
                  aria-label={`${isSelected ? '取消选择' : '选择'}图库图片 ${i + 1}，${Math.round(img.size / 1024)}KB`}
                  onClick={() => !isDisabled && toggleSelect(img.id)}
                  className={`absolute inset-0 block h-full w-full ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Image
                    src={img.dataUrl}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 33vw, 130px"
                    className="object-cover"
                    unoptimized
                  />
                  {/* 选中标记 */}
                  {isSelected && (
                    <span className="absolute inset-0 flex items-center justify-center bg-[var(--color-brand-strong)]/20">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand-strong)] shadow-lg">
                        <Check className="h-4 w-4 text-white" strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    </span>
                  )}
                  {/* 尺寸标签 */}
                  <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-left text-[10px] text-white">
                    {Math.round(img.size / 1024)}KB
                  </span>
                </button>
                {/* 删除按钮：与选择按钮并列（不嵌套）；触屏常驻，桌面端悬停或键盘聚焦时浮现 */}
                <button
                  type="button"
                  onClick={() => { void handleDelete(img.id); }}
                  className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-ink)]/70 text-white opacity-100 transition-all hover:bg-[var(--color-danger)] focus-visible:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                  aria-label={`删除图库图片 ${i + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
