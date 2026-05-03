'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
  footer?: React.ReactNode;
  zIndex?: number;
}

export function ImageLightbox({ src, alt, onClose, footer, zIndex = 50 }: ImageLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 animate-fade-in"
      style={{ zIndex }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div className="relative max-w-5xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-14 right-0 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="关闭"
          autoFocus
        >
          <X className="w-6 h-6" />
        </button>

        <img
          src={src}
          alt={alt}
          className="w-full h-auto max-h-[85vh] object-contain rounded-2xl shadow-2xl"
        />

        {footer && (
          <div className="absolute -bottom-14 left-1/2 -translate-x-1/2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
