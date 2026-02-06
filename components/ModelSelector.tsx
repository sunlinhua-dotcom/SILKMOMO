'use client';

import { MODELS } from '@/lib/models';
import { User, Check } from 'lucide-react';
import { MODEL_ICONS } from './ModelIcons';

interface ModelSelectorProps {
    selectedModel: string;
    onSelect: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
                <User className="w-4 h-4 text-neutral-400" />
                <span className="text-sm font-medium text-neutral-600">选择模特 (Model)</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {MODELS.map((model) => {
                    const isSelected = model.id === selectedModel;
                    return (
                        <button
                            key={model.id}
                            onClick={() => onSelect(model.id)}
                            className={`
                relative group flex flex-col items-center text-center p-3 rounded-xl border transition-all duration-200
                ${isSelected
                                    ? 'border-[#C9A86C] bg-[#C9A86C]/5 ring-1 ring-[#C9A86C]'
                                    : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm'
                                }
              `}
                        >
                            {isSelected && (
                                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#C9A86C] flex items-center justify-center">
                                    <Check className="w-3 h-3 text-white" />
                                </div>
                            )}

                            {/* Icon Container */}
                            <div className={`w-16 h-16 rounded-full mb-3 flex items-center justify-center transition-all duration-300
                ${isSelected ? 'bg-[#C9A86C]/10 text-[#C9A86C]' : 'bg-neutral-50 text-neutral-400 group-hover:bg-neutral-100 group-hover:text-neutral-600'}
              `}>
                                {(() => {
                                    const Icon = MODEL_ICONS[model.id];
                                    return Icon ? (
                                        <Icon className="w-10 h-10 stroke-1" />
                                    ) : <User className="w-8 h-8" />;
                                })()}
                            </div>

                            <h3 className={`font-medium text-sm mb-1 ${isSelected ? 'text-[#C9A86C]' : 'text-neutral-900'}`}>
                                {model.name}
                            </h3>
                            <p className="text-xs text-neutral-500 line-clamp-2">
                                {model.gender === 'female' ? 'Female' : 'Male'} · {model.description.split('，')[0]}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
