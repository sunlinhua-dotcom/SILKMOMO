'use client';

import { useId } from 'react';
import { SKIN_TONES } from '@/lib/models';
import { useRadioGroup } from './useRadioGroup';

interface SkinToneSelectorProps {
  selectedSkinTone: 'light' | 'medium' | 'deep';
  onSelect: (skinTone: 'light' | 'medium' | 'deep') => void;
}

export function SkinToneSelector({ selectedSkinTone, onSelect }: SkinToneSelectorProps) {
  const labelId = useId();
  const { groupProps, itemProps } = useRadioGroup(SKIN_TONES.map(t => t.id), selectedSkinTone, onSelect);
  return (
    <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-border-light">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 id={labelId} className="text-sm font-semibold text-ink">肤色</h3>
          <p className="text-xs text-muted mt-0.5">与模特参考图的外貌特征独立控制</p>
        </div>
        <span className="text-xs text-text-secondary px-2 py-1 bg-background rounded-lg">
          {SKIN_TONES.find(t => t.id === selectedSkinTone)?.name}
        </span>
      </div>

      <div {...groupProps} aria-labelledby={labelId} className="grid grid-cols-3 gap-3">
        {SKIN_TONES.map((tone) => (
          <button
            key={tone.id}
            type="button"
            {...itemProps(tone.id)}
            onClick={() => onSelect(tone.id)}
            className={`
              relative flex flex-col items-center gap-2.5 p-3 min-h-10 rounded-xl border transition-all duration-200
              ${selectedSkinTone === tone.id
                ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong shadow-sm'
                : 'border-border hover:border-brand-strong/60 hover:bg-background'
              }
            `}
          >
            {/* 肤色色块 */}
            <div
              aria-hidden="true"
              className="w-10 h-10 rounded-full shadow-sm ring-2 ring-white/80 transition-transform duration-200"
              style={{
                backgroundColor: tone.hexSample,
                transform: selectedSkinTone === tone.id ? 'scale(1.1)' : 'scale(1)'
              }}
            />

            {/* 名称 */}
            <span className="text-sm font-medium text-ink">
              {tone.name}
            </span>

            {/* 描述 */}
            <span className="text-xs text-text-secondary text-center leading-tight">
              {tone.description}
            </span>

            {/* 选中指示器 */}
            {selectedSkinTone === tone.id && (
              <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-brand-strong flex items-center justify-center">
                <svg aria-hidden="true" className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
