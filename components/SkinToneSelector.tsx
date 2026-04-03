'use client';

import { SKIN_TONES, type SkinToneConfig } from '@/lib/models';

interface SkinToneSelectorProps {
  selectedSkinTone: 'light' | 'medium' | 'deep';
  onSelect: (skinTone: 'light' | 'medium' | 'deep') => void;
}

export function SkinToneSelector({ selectedSkinTone, onSelect }: SkinToneSelectorProps) {
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">肤色</h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">与模特参考图的外貌特征独立控制</p>
        </div>
        <span className="text-xs text-[var(--color-text-muted)] px-2 py-1 bg-[var(--color-background)] rounded-lg">
          {SKIN_TONES.find(t => t.id === selectedSkinTone)?.name}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {SKIN_TONES.map((tone) => (
          <button
            key={tone.id}
            onClick={() => onSelect(tone.id)}
            className={`
              relative flex flex-col items-center gap-2.5 p-3 rounded-xl border transition-all duration-200
              ${selectedSkinTone === tone.id
                ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)] shadow-sm'
                : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
              }
            `}
          >
            {/* 肤色色块 */}
            <div
              className="w-10 h-10 rounded-full shadow-sm ring-2 ring-white/80 transition-transform duration-200"
              style={{
                backgroundColor: tone.hexSample,
                transform: selectedSkinTone === tone.id ? 'scale(1.1)' : 'scale(1)'
              }}
            />

            {/* 名称 */}
            <span className={`text-sm font-medium ${
              selectedSkinTone === tone.id
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)]'
            }`}>
              {tone.name}
            </span>

            {/* 描述 */}
            <span className="text-xs text-[var(--color-text-muted)] text-center leading-tight">
              {tone.description}
            </span>

            {/* 选中指示器 */}
            {selectedSkinTone === tone.id && (
              <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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
