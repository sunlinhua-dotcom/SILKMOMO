'use client';

import { useState, useEffect } from 'react';
import { X, Check, ImageIcon, Trash2 } from 'lucide-react';
import { getLibraryImages, removeFromLibrary, libraryToCompressed, type LibraryImage } from '@/lib/image-library';
import type { CompressedImage } from '@/lib/image-compressor';

interface ImageLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (images: CompressedImage[]) => void;
  maxSelect: number;       // 最多可选几张
  currentCount: number;    // 当前已有几张
}

export function ImageLibraryPicker({
  isOpen,
  onClose,
  onSelect,
  maxSelect,
  currentCount,
}: ImageLibraryPickerProps) {
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const remaining = maxSelect - currentCount;

  useEffect(() => {
    if (isOpen) {
      setLibraryImages(getLibraryImages());
      setSelected(new Set());
    }
  }, [isOpen]);

  if (!isOpen) return null;

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

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = removeFromLibrary(id);
    setLibraryImages(updated);
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
         onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-[var(--color-surface)] rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-light)]">
          <div>
            <h3 className="font-serif text-lg text-[var(--color-primary)]">图库</h3>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
              选择之前上传过的图片（还可选 {remaining - selected.size} 张）
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-background)] transition-colors">
            <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
        </div>

        {/* 图片网格 */}
        <div className="flex-1 overflow-y-auto p-4">
          {libraryImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ImageIcon className="w-10 h-10 text-[var(--color-text-muted)] mb-3" strokeWidth={1} />
              <p className="text-sm text-[var(--color-text-secondary)]">图库为空</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">上传的图片会自动保存到图库</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {libraryImages.map(img => {
                const isSelected = selected.has(img.id);
                const isDisabled = !isSelected && selected.size >= remaining;
                return (
                  <div
                    key={img.id}
                    onClick={() => !isDisabled && toggleSelect(img.id)}
                    className={`
                      relative aspect-square rounded-xl overflow-hidden cursor-pointer
                      ring-2 transition-all duration-200
                      ${isSelected
                        ? 'ring-[var(--color-accent)] scale-[0.96]'
                        : isDisabled
                          ? 'ring-transparent opacity-40 cursor-not-allowed'
                          : 'ring-transparent hover:ring-[var(--color-border)]'
                      }
                    `}
                  >
                    <img
                      src={img.dataUrl}
                      alt="图库图片"
                      className="w-full h-full object-cover"
                    />
                    {/* 选中标记 */}
                    {isSelected && (
                      <div className="absolute inset-0 bg-[var(--color-accent)]/20 flex items-center justify-center">
                        <div className="w-7 h-7 rounded-full bg-[var(--color-accent)] flex items-center justify-center shadow-lg">
                          <Check className="w-4 h-4 text-white" strokeWidth={2.5} />
                        </div>
                      </div>
                    )}
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDelete(img.id, e)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all hover:opacity-100"
                      style={{ opacity: undefined }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                    >
                      <Trash2 className="w-3 h-3 text-white" />
                    </button>
                    {/* 尺寸标签 */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1">
                      <span className="text-[9px] text-white/80">{Math.round(img.size / 1024)}KB</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        {libraryImages.length > 0 && (
          <div className="px-5 py-3 border-t border-[var(--color-border-light)] flex items-center justify-between">
            <span className="text-xs text-[var(--color-text-muted)]">
              已选 {selected.size} 张
            </span>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className="btn-primary !py-2 !px-6 !text-sm"
            >
              确认选择
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
