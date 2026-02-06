'use client';

import { Upload, X, Sparkles } from 'lucide-react';
import { compressImage, type CompressedImage } from '@/lib/image-compressor';
import { useState } from 'react';

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

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;
    const fileArray = Array.from(files);
    const remainingSlots = maxFiles - images.length;
    const filesToProcess = fileArray.slice(0, remainingSlots);

    try {
      const compressed = await Promise.all(
        filesToProcess.map(file => compressImage(file))
      );
      onImagesChange([...images, ...compressed]);
    } catch (error) {
      console.error('图片压缩失败:', error);
    }
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
    <div className={`upload-card ${cardVariant} p-5 sm:p-6`}>
      {/* 标题栏 */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-semibold text-[var(--color-text)]">
            {title}
          </h3>
          {required && (
            <span className="text-[var(--color-accent)] text-sm">*</span>
          )}
        </div>
        <span className={`count-badge ${images.length > 0 ? 'active' : ''}`}>
          {images.length}/{maxFiles}
        </span>
      </div>

      {/* 描述 */}
      <p className="text-sm text-[var(--color-text-secondary)] mb-4 -mt-2">
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
            multiple={maxFiles > 1}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <div className={`upload-zone-icon bg-gradient-to-br ${iconGradient}`}>
            <Upload className="w-5 h-5" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-[var(--color-text)] mb-1 font-medium">
            {isDragging ? '松开以上传' : '点击或拖拽图片到这里'}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            JPG · PNG · WebP
          </p>
        </label>
      )}

      {/* 图片预览 */}
      {images.length > 0 && (
        <div className="image-grid">
          {images.map((image, index) => (
            <div key={index} className="image-thumb">
              <img
                src={image.dataUrl}
                alt={`${title} ${index + 1}`}
                className="w-full h-full object-cover"
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
          {/* 添加更多按钮 */}
          {images.length < maxFiles && (
            <label className="image-thumb cursor-pointer flex items-center justify-center bg-[var(--color-background)] border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
              <input
                type="file"
                className="hidden"
                accept="image/*"
                multiple={maxFiles - images.length > 1}
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
  );
}
