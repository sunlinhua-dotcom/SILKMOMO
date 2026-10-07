'use client';

import { useId } from 'react';
import { MODELS, ETHNICITY_LABELS } from '@/lib/models';
import { MODEL_ICONS } from './ModelIcons';
import { User } from 'lucide-react';

interface ModelQuickPickerProps {
    selectedModel: string;
    onSelect: (modelId: string) => void;
}

// 再点一次已选项会取消选择（回到「按品牌记忆」），所以语义是一组可开关的按钮（aria-pressed），
// 不是 radiogroup——radio 不该被点掉。
export function ModelQuickPicker({ selectedModel, onSelect }: ModelQuickPickerProps) {
    const labelId = useId();
    return (
        <div className="space-y-2.5">
            <div className="flex items-center gap-2 px-1 flex-wrap">
                <User className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
                <span id={labelId} className="text-xs font-medium tracking-widest uppercase text-text-secondary">模特</span>
                <span className="text-xs text-muted normal-case tracking-normal">未选则按品牌记忆</span>
            </div>
            <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
                {MODELS.map((model) => {
                    const isSelected = model.id === selectedModel;
                    const Icon = MODEL_ICONS[model.id];
                    const genderLabel = model.gender === 'female' ? '女' : '男';
                    const ethnicityLabel = ETHNICITY_LABELS[model.ethnicity];
                    return (
                        <button
                            key={model.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => onSelect(isSelected ? '' : model.id)}
                            className={`
                                cursor-pointer flex items-center gap-2 px-3 py-2 min-h-10 rounded-xl border transition-all duration-200
                                ${isSelected
                                    ? 'border-brand-strong bg-brand-soft text-ink ring-1 ring-brand-strong'
                                    : 'border-border bg-surface hover:border-brand-strong/60 hover:shadow-sm text-text-secondary'
                                }
                            `}
                        >
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors
                                ${isSelected ? 'bg-surface text-brand-strong' : 'bg-background'}
                            `}>
                                {Icon ? <Icon className="w-5 h-5 stroke-[1.25]" /> : <User className="w-4 h-4" aria-hidden="true" />}
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
