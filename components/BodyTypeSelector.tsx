'use client';

import { BODY_TYPES, type BodyType } from '@/lib/models';

interface BodyTypeSelectorProps {
    selectedBodyType: 'slim' | 'curvy';
    onSelect: (bodyType: 'slim' | 'curvy') => void;
}

export function BodyTypeSelector({ selectedBodyType, onSelect }: BodyTypeSelectorProps) {
    return (
        <div className="bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                体型选择
            </h3>

            <div className="flex gap-3">
                {BODY_TYPES.map((bodyType: BodyType) => {
                    const isSelected = selectedBodyType === bodyType.id;
                    return (
                        <button
                            key={bodyType.id}
                            onClick={() => onSelect(bodyType.id)}
                            className={`
                flex-1 py-3 px-4 rounded-xl text-center transition-all
                ${isSelected
                                    ? 'bg-[var(--color-accent)] text-white shadow-md'
                                    : 'bg-[var(--color-background)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-alt)] border border-[var(--color-border-light)]'
                                }
              `}
                        >
                            <div className="text-sm font-medium">{bodyType.name}</div>
                            <div className={`text-xs mt-1 ${isSelected ? 'text-white/80' : 'text-[var(--color-text-muted)]'}`}>
                                {bodyType.description}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
