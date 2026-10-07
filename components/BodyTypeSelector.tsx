'use client';

import { useId } from 'react';
import { BODY_TYPES } from '@/lib/models';
import { useRadioGroup } from './useRadioGroup';

interface BodyTypeSelectorProps {
  selectedBodyType: 'slim' | 'standard' | 'curvy';
  onSelect: (bodyType: 'slim' | 'standard' | 'curvy') => void;
}

const BODY_ICONS: Record<string, React.ReactNode> = {
  slim: (
    // 纤细：修长细腰图标
    <svg aria-hidden="true" className="w-8 h-8" viewBox="0 0 32 60" fill="none">
      <ellipse cx="16" cy="6" rx="5" ry="5" fill="currentColor" opacity="0.7" />
      <path d="M11 14 Q16 20 21 14 L24 36 Q16 32 8 36 Z" fill="currentColor" opacity="0.5" />
      <path d="M10 36 L9 56 Q16 52 23 56 L22 36" fill="currentColor" opacity="0.4" />
    </svg>
  ),
  standard: (
    // 标准：匀称比例
    <svg aria-hidden="true" className="w-8 h-8" viewBox="0 0 36 60" fill="none">
      <ellipse cx="18" cy="6" rx="5.5" ry="5.5" fill="currentColor" opacity="0.7" />
      <path d="M12 14 Q18 18 24 14 L27 36 Q18 31 9 36 Z" fill="currentColor" opacity="0.5" />
      <path d="M11 36 L10 56 Q18 51 26 56 L25 36" fill="currentColor" opacity="0.4" />
    </svg>
  ),
  curvy: (
    // 饱满：丰盈曲线
    <svg aria-hidden="true" className="w-8 h-8" viewBox="0 0 40 60" fill="none">
      <ellipse cx="20" cy="6" rx="6" ry="6" fill="currentColor" opacity="0.7" />
      <path d="M12 14 Q20 16 28 14 L33 36 Q20 30 7 36 Z" fill="currentColor" opacity="0.5" />
      <path d="M9 36 L7 56 Q20 50 33 56 L31 36" fill="currentColor" opacity="0.4" />
    </svg>
  )
};

export function BodyTypeSelector({ selectedBodyType, onSelect }: BodyTypeSelectorProps) {
  const labelId = useId();
  const { groupProps, itemProps } = useRadioGroup(BODY_TYPES.map(t => t.id), selectedBodyType, onSelect);
  return (
    <div className="bg-surface rounded-2xl p-5 sm:p-6 border border-border-light">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 id={labelId} className="text-sm font-semibold text-ink">体型</h3>
          <p className="text-xs text-muted mt-0.5">影响服装版型的展示效果</p>
        </div>
        <span className="text-xs text-text-secondary px-2 py-1 bg-background rounded-lg">
          {BODY_TYPES.find(t => t.id === selectedBodyType)?.name}
        </span>
      </div>

      <div {...groupProps} aria-labelledby={labelId} className="grid grid-cols-3 gap-3">
        {BODY_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            {...itemProps(type.id)}
            onClick={() => onSelect(type.id)}
            className={`
              relative flex flex-col items-center gap-2 p-3 min-h-10 rounded-xl border transition-all duration-200
              ${selectedBodyType === type.id
                ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong shadow-sm'
                : 'border-border hover:border-brand-strong/60 hover:bg-background'
              }
            `}
          >
            {/* 图标 */}
            <div className={`mt-1 transition-colors duration-200 ${
              selectedBodyType === type.id
                ? 'text-brand-strong'
                : 'text-muted'
            }`}>
              {BODY_ICONS[type.id]}
            </div>

            {/* 名称 */}
            <span className="text-sm font-semibold leading-none text-ink">
              {type.name}
            </span>

            {/* 描述 */}
            <span className="text-xs text-text-secondary text-center leading-tight">
              {type.description}
            </span>

            {/* 选中指示器 */}
            {selectedBodyType === type.id && (
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
