'use client';

import { MODELS, ETHNICITY_LABELS } from '@/lib/models';
import { MODEL_ICONS } from './ModelIcons';
import { User } from 'lucide-react';

interface ModelQuickPickerProps {
    selectedModel: string;
    onSelect: (modelId: string) => void;
}

export function ModelQuickPicker({ selectedModel, onSelect }: ModelQuickPickerProps) {
    return (
        <div className="space-y-2.5">
            <div className="flex items-center gap-2 px-1">
                <User className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                <span className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">模特</span>
                <span className="text-[10px] text-[var(--color-text-muted)] normal-case tracking-normal">未选则按品牌记忆</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
                {MODELS.map((model) => {
                    const isSelected = model.id === selectedModel;
                    const Icon = MODEL_ICONS[model.id];
                    const genderLabel = model.gender === 'female' ? '女' : '男';
                    const ethnicityLabel = ETHNICITY_LABELS[model.ethnicity];
                    return (
                        <button
                            key={model.id}
                            onClick={() => onSelect(isSelected ? '' : model.id)}
                            className={`
                                flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border transition-all duration-200
                                ${isSelected
                                    ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)] text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                                    : 'border-[var(--color-border-light)] bg-white hover:border-[var(--color-border)] text-[var(--color-text-secondary)]'
                                }
                            `}
                        >
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors
                                ${isSelected ? 'bg-[rgba(201,168,108,0.12)]' : 'bg-[var(--color-background)]'}
                            `}>
                                {Icon ? <Icon className="w-5 h-5 stroke-[1.25]" /> : <User className="w-4 h-4" />}
                            </div>
                            <span className="text-xs font-medium whitespace-nowrap">
                                {genderLabel}·{ethnicityLabel}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
