'use client';

import { STYLES } from '@/lib/styles';
import { Camera, Check } from 'lucide-react';
import { STYLE_ICONS } from './StyleIcons';

interface StyleSelectorProps {
    selectedStyle: string;
    onSelect: (styleId: string) => void;
}

export function StyleSelector({ selectedStyle, onSelect }: StyleSelectorProps) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
                <Camera className="w-4 h-4 text-neutral-400" />
                <span className="text-sm font-medium text-neutral-600">选择拍摄风格 (Style)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {STYLES.map((style) => {
                    const isSelected = style.id === selectedStyle;
                    return (
                        <button
                            key={style.id}
                            onClick={() => onSelect(style.id)}
                            className={`
                relative group flex flex-col items-start p-3 rounded-xl border transition-all duration-200 text-left h-full
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

                            <div className={`w-full aspect-[4/3] rounded-lg mb-3 overflow-hidden relative flex items-center justify-center transition-all duration-300
                                ${isSelected ? 'bg-[#C9A86C]/10' : 'bg-neutral-50 group-hover:bg-neutral-100'}
                            `}>
                                {/* SVG Icon */}
                                {(() => {
                                    const Icon = STYLE_ICONS[style.id];
                                    return Icon ? (
                                        <Icon className={`w-12 h-12 transition-all duration-300 stroke-1
                      ${isSelected ? 'text-[#C9A86C] scale-110' : 'text-neutral-400 group-hover:text-neutral-600 group-hover:scale-105'}
                    `} />
                                    ) : null;
                                })()}
                            </div>

                            <h3 className={`font-medium text-sm mb-1 ${isSelected ? 'text-[#C9A86C]' : 'text-neutral-900'}`}>
                                {style.name}
                            </h3>
                            <p className="text-xs text-neutral-500 line-clamp-2 leading-relaxed">
                                {style.description}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// Helper removed as we use icons now
