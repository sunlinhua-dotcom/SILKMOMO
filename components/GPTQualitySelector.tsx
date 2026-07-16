'use client';

import { Check, Gauge } from 'lucide-react';
import {
  GPT_IMAGE_QUALITY_OPTIONS,
  type GenerationQuality,
} from '@/lib/billing-constants';

interface GPTQualitySelectorProps {
  value: GenerationQuality;
  onChange: (quality: GenerationQuality) => void;
  variant?: 'full' | 'compact';
}

const formatYuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export function GPTQualitySelector({ value, onChange, variant = 'full' }: GPTQualitySelectorProps) {
  if (variant === 'compact') {
    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 px-1">
          <Gauge className="w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <span className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">GPT 画质</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {GPT_IMAGE_QUALITY_OPTIONS.map(option => {
            const isSelected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChange(option.id)}
                className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-xl border transition-all duration-200 [word-break:keep-all] ${
                  isSelected
                    ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)] text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                    : 'border-[var(--color-border-light)] bg-white hover:border-[var(--color-border)] hover:shadow-sm text-[var(--color-text-secondary)]'
                }`}
              >
                <span className="text-xs font-medium whitespace-nowrap">{option.label}</span>
                <span className={`text-[10px] whitespace-nowrap tabular-nums ${isSelected ? 'text-[var(--color-accent)]/80' : 'text-[var(--color-text-muted)]'}`}>
                  {formatYuan(option.priceFen)} · {option.etaLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Gauge className="w-4 h-4 text-neutral-400" aria-hidden="true" />
        <span className="text-sm font-medium text-neutral-600">GPT 画质档位</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {GPT_IMAGE_QUALITY_OPTIONS.map(option => {
          const isSelected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={`relative text-left p-4 rounded-xl border transition-all duration-200 [word-break:keep-all] ${
                isSelected
                  ? 'border-[#C9A86C] bg-[#C9A86C]/5 ring-1 ring-[#C9A86C]'
                  : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm'
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#C9A86C] flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" aria-hidden="true" />
                </div>
              )}
              <p className={`text-sm font-medium mb-2 ${isSelected ? 'text-[#C9A86C]' : 'text-neutral-900'}`}>
                {option.label}
              </p>
              <p className="text-lg font-bold tabular-nums text-[var(--color-text)]">{formatYuan(option.priceFen)}</p>
              <p className="text-[11px] mt-1 text-neutral-500 whitespace-nowrap">{option.etaLabel}/张</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
