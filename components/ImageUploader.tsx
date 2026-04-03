'use client';

import { Upload, X, Sparkles, FolderOpen, ImageIcon } from 'lucide-react';
import { compressImage, type CompressedImage } from '@/lib/image-compressor';
import { addToLibrary, getLibraryImages } from '@/lib/image-library';
import { ImageLibraryPicker } from './ImageLibraryPicker';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

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
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 图库中有图片数量（用于显示按钮提示）— 客户端加载避免 hydration mismatch
  const [libraryCount, setLibraryCount] = useState(0);
  useEffect(() => {
    setLibraryCount(getLibraryImages().length);
  }, [images]);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const imageFiles = Array.from(files).filter(f =>
      f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name)
    );

    if (imageFiles.length === 0) return;

    const remainingSlots = maxFiles - images.length;
    const filesToProcess = imageFiles.slice(0, remainingSlots);

    setIsProcessing(true);
    try {
      const compressed = await Promise.all(
        filesToProcess.map(file => compressImage(file))
      );
      const newImages = [...images, ...compressed];
      onImagesChange(newImages);

      // 自动保存到图库
      addToLibrary(compressed);
    } catch (error) {
      console.error('图片压缩失败:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLibrarySelect = (selectedImages: CompressedImage[]) => {
    const remainingSlots = maxFiles - images.length;
    const toAdd = selectedImages.slice(0, remainingSlots);
    onImagesChange([...images, ...toAdd]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const removeImage = (index: number) => {
    onImagesChange(images.filter((_, i) => i !== index));
  };

  const cardVariant = {
    gold: 'upload-card-gold',
    gray: 'upload-card-gray',
    dashed: 'upload-card-dashed',
  }[variant];

  const iconGradient = {
    gold: 'from-[#C9A86C] to-[#D4B87D]',
    gray: 'from-gray-400 to-gray-500',
    dashed: 'from-[#C9A86C] to-[#D4B87D]',
  }[variant];

  return (
    <>
      <div className={`upload-card ${cardVariant} p-4 sm:p-6`}>
        {/* 标题栏 */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-semibold text-[var(--color-text)]">
              {title}
            </h3>
            {required && (
              <span className="text-[var(--color-accent)] text-sm">*</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 图库按钮 */}
            {libraryCount > 0 && images.length < maxFiles && (
              <button
                type="button"
                onClick={() => setShowLibrary(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-all"
              >
                <ImageIcon className="w-3 h-3" />
                图库 {libraryCount}
              </button>
            )}
            <span className={`count-badge ${images.length > 0 ? 'active' : ''}`}>
              {images.length}/{maxFiles}
            </span>
          </div>
        </div>

        {/* 描述 */}
        <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] mb-3 -mt-1">
          {description}
        </p>

        {/* 上传区域 */}
        {images.length < maxFiles && (
          <label
            className={`upload-zone ${isDragging ? 'dragging' : ''} group`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => handleFileSelect(e.target.files)}
            />
            {isProcessing ? (
              <>
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center mb-3">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
                <p className="text-sm text-[var(--color-text)] font-medium">处理中...</p>
              </>
            ) : (
              <>
                <div className={`upload-zone-icon bg-gradient-to-br ${iconGradient}`}>
                  <Upload className="w-5 h-5" strokeWidth={1.5} />
                </div>
                <p className="text-sm text-[var(--color-text)] mb-1 font-medium">
                  {isDragging ? '松开以上传' : '点击选择或拖拽图片'}
                </p>
                <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
                  JPG · PNG · WebP · 支持多选
                </p>
                <div className="flex items-center gap-2">
                  {/* 文件夹上传 */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-primary)] transition-all"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    文件夹
                  </button>
                  {/* 从图库选择 */}
                  {libraryCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowLibrary(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-all"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      图库选择
                    </button>
                  )}
                </div>
              </>
            )}
          </label>
        )}

        {/* 隐藏的文件夹 input */}
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          accept="image/*"
          multiple
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => handleFileSelect(e.target.files)}
        />

        {/* 图片预览 */}
        {images.length > 0 && (
          <div className="image-grid">
            {images.map((image, index) => (
              <div key={index} className="image-thumb">
                <Image
                  src={image.dataUrl}
                  alt={`${title} ${index + 1}`}
                  className="w-full h-full object-cover"
                  width={200}
                  height={200}
                  unoptimized
                />
                <button
                  onClick={() => removeImage(index)}
                  className="image-thumb-remove"
                  aria-label="删除"
                >
                  <X className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                </button>
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/60 to-transparent">
                  <p className="text-[10px] text-white/90 text-center font-medium">
                    {Math.round(image.size / 1024)}KB
                  </p>
                </div>
              </div>
            ))}
            {images.length < maxFiles && (
              <label className="image-thumb cursor-pointer flex items-center justify-center bg-[var(--color-background)] border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleFileSelect(e.target.files)}
                />
                <div className="text-center">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center mx-auto mb-1">
                    <Sparkles className="w-4 h-4 text-white" strokeWidth={2} />
                  </div>
                  <span className="text-[10px] text-[var(--color-text-secondary)]">
                    添加
                  </span>
                </div>
              </label>
            )}
          </div>
        )}
      </div>

      {/* 图库弹窗 */}
      <ImageLibraryPicker
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelect={handleLibrarySelect}
        maxSelect={maxFiles}
        currentCount={images.length}
      />
    </>
  );
}
