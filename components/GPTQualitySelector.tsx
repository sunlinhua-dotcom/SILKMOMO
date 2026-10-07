'use client';

import { useId } from 'react';
import { Check, Gauge } from 'lucide-react';
import {
  GPT_IMAGE_QUALITY_OPTIONS,
  type GenerationQuality,
} from '@/lib/billing-constants';
import { useRadioGroup } from './useRadioGroup';

interface GPTQualitySelectorProps {
  value: GenerationQuality;
  onChange: (quality: GenerationQuality) => void;
  variant?: 'full' | 'compact';
}

const formatYuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export function GPTQualitySelector({ value, onChange, variant = 'full' }: GPTQualitySelectorProps) {
  const labelId = useId();
  const { groupProps, itemProps } = useRadioGroup(
    GPT_IMAGE_QUALITY_OPTIONS.map(o => o.id),
    value,
    onChange,
  );

  if (variant === 'compact') {
    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 px-1">
          <Gauge className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
          <span id={labelId} className="text-xs font-medium tracking-widest uppercase text-text-secondary">GPT 画质</span>
        </div>
        <div {...groupProps} aria-labelledby={labelId} className="flex flex-wrap gap-2">
          {GPT_IMAGE_QUALITY_OPTIONS.map(option => {
            const isSelected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                {...itemProps(option.id)}
                onClick={() => onChange(option.id)}
                className={`cursor-pointer flex items-center gap-2 px-3 py-2 min-h-10 rounded-xl border transition-all duration-200 [word-break:keep-all] ${
                  isSelected
                    ? 'border-brand-strong bg-brand-soft text-ink ring-1 ring-brand-strong'
                    : 'border-border bg-surface hover:border-brand-strong/60 hover:shadow-sm text-text-secondary'
                }`}
              >
                <span className="text-xs font-medium whitespace-nowrap">{option.label}</span>
                <span className={`text-xs whitespace-nowrap tabular-nums ${isSelected ? 'text-text-secondary' : 'text-muted'}`}>
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
        <Gauge className="w-4 h-4 text-muted" aria-hidden="true" />
        <span id={labelId} className="text-sm font-medium text-text-secondary">GPT 画质档位</span>
      </div>
      <div {...groupProps} aria-labelledby={labelId} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {GPT_IMAGE_QUALITY_OPTIONS.map(option => {
          const isSelected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              {...itemProps(option.id)}
              onClick={() => onChange(option.id)}
              className={`relative text-left p-4 min-h-10 rounded-xl border transition-all duration-200 [word-break:keep-all] ${
                isSelected
                  ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                  : 'border-border bg-surface hover:border-brand-strong/60 hover:shadow-sm'
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-brand-strong flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" aria-hidden="true" />
                </div>
              )}
              <p className="text-sm font-medium mb-2 text-ink">
                {option.label}
              </p>
              <p className="text-lg font-bold tabular-nums text-ink">{formatYuan(option.priceFen)}</p>
              <p className="text-xs mt-1 text-text-secondary whitespace-nowrap">{option.etaLabel}/张</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
