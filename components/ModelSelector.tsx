'use client';

import { useId } from 'react';
import { MODELS } from '@/lib/models';
import { User, Check } from 'lucide-react';
import { MODEL_ICONS } from './ModelIcons';
import { useRadioGroup } from './useRadioGroup';

interface ModelSelectorProps {
    selectedModel: string;
    onSelect: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
    const labelId = useId();
    const { groupProps, itemProps } = useRadioGroup(MODELS.map((m) => m.id), selectedModel, onSelect);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
                <User className="w-4 h-4 text-muted" aria-hidden="true" />
                <span id={labelId} className="text-sm font-medium text-text-secondary">选择模特 (Model)</span>
            </div>

            <div {...groupProps} aria-labelledby={labelId} className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {MODELS.map((model) => {
                    const isSelected = model.id === selectedModel;
                    const Icon = MODEL_ICONS[model.id];
                    return (
                        <button
                            key={model.id}
                            type="button"
                            {...itemProps(model.id)}
                            onClick={() => onSelect(model.id)}
                            className={`
                relative group flex flex-col items-center text-center p-3 min-h-10 rounded-xl border transition-all duration-200
                ${isSelected
                                    ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                                    : 'border-border bg-surface hover:border-brand-strong/60 hover:shadow-sm'
                                }
              `}
                        >
                            {isSelected && (
                                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brand-strong flex items-center justify-center">
                                    <Check className="w-3 h-3 text-white" aria-hidden="true" />
                                </div>
                            )}

                            {/* Icon Container */}
                            <div className={`w-16 h-16 rounded-full mb-3 flex items-center justify-center transition-all duration-300
                ${isSelected ? 'bg-surface text-brand-strong' : 'bg-background text-muted group-hover:text-text-secondary'}
              `}>
                                {Icon ? (
                                    <Icon className="w-10 h-10 stroke-1" />
                                ) : <User className="w-8 h-8" aria-hidden="true" />}
                            </div>

                            <h3 className="font-medium text-sm mb-1 text-ink">
                                {model.name}
                            </h3>
                            <p className="text-xs text-text-secondary line-clamp-2">
                                {model.gender === 'female' ? 'Female' : 'Male'} · {model.description.split('，')[0]}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
