'use client';

import { Check, Sparkles, Zap } from 'lucide-react';

export type ImageEngine = 'gemini' | 'openai';

export const ENGINES: Array<{
    id: ImageEngine;
    name: string;
    sub: string;
    desc: string;
    speed: string;   // 实测单张耗时预期，帮用户在"快"和"质感"之间自主选择
    icon: typeof Sparkles;
}> = [
        {
            id: 'gemini',
            name: 'Gemini Flash Image',
            sub: 'gemini-3.1-flash-image',
            desc: 'Lifestyle / 多图参考稳定 / 暖色背景',
            speed: '约 30 秒/张',
            icon: Sparkles,
        },
        {
            id: 'openai',
            name: 'GPT Image 2',
            sub: 'gpt-image-2',
            desc: '面料 macro / 极致缎面光泽 / 详情页面料展示',
            speed: '约 35-150 秒/张',
            icon: Zap,
        },
    ];

interface EngineSelectorProps {
    selected: ImageEngine;
    onSelect: (engine: ImageEngine) => void;
    variant?: 'full' | 'compact'; // full = 卡片模式（task / brand 页），compact = chip 模式（home Step 2）
}

export function EngineSelector({ selected, onSelect, variant = 'full' }: EngineSelectorProps) {
    if (variant === 'compact') {
        return (
            <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                    <span className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">生图引擎</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {ENGINES.map((e) => {
                        const isSelected = e.id === selected;
                        const Icon = e.icon;
                        return (
                            <button
                                key={e.id}
                                onClick={() => onSelect(e.id)}
                                className={`
                                    cursor-pointer flex items-center gap-2 px-3 py-2 rounded-xl border transition-all duration-200
                                    ${isSelected
                                        ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)] text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                                        : 'border-[var(--color-border-light)] bg-white hover:border-[var(--color-border)] hover:shadow-sm text-[var(--color-text-secondary)]'
                                    }
                                `}
                            >
                                <Icon className="w-4 h-4" strokeWidth={1.5} />
                                <span className="text-xs font-medium whitespace-nowrap">{e.name}</span>
                                <span className={`text-[10px] whitespace-nowrap ${isSelected ? 'text-[var(--color-accent)]/80' : 'text-[var(--color-text-muted)]'}`}>
                                    {e.speed}
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
                <Sparkles className="w-4 h-4 text-neutral-400" />
                <span className="text-sm font-medium text-neutral-600">选择生图引擎 (Engine)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ENGINES.map((e) => {
                    const isSelected = e.id === selected;
                    const Icon = e.icon;
                    return (
                        <button
                            key={e.id}
                            onClick={() => onSelect(e.id)}
                            className={`
                                relative text-left p-4 rounded-xl border transition-all duration-200
                                ${isSelected
                                    ? 'border-[#C9A86C] bg-[#C9A86C]/5 ring-1 ring-[#C9A86C]'
                                    : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm'
                                }
                            `}
                        >
                            {isSelected && (
                                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#C9A86C] flex items-center justify-center">
                                    <Check className="w-3 h-3 text-white" />
                                </div>
                            )}
                            <div className={`w-10 h-10 rounded-xl mb-3 flex items-center justify-center
                                ${isSelected ? 'bg-[#C9A86C]/10 text-[#C9A86C]' : 'bg-neutral-50 text-neutral-400'}
                            `}>
                                <Icon className="w-5 h-5" strokeWidth={1.5} />
                            </div>
                            <h3 className={`font-medium text-sm mb-0.5 ${isSelected ? 'text-[#C9A86C]' : 'text-neutral-900'}`}>
                                {e.name}
                            </h3>
                            <p className="text-[10px] tracking-wider text-neutral-400 mb-1.5 font-mono">{e.sub}</p>
                            <p className="text-xs text-neutral-500 leading-relaxed">{e.desc}</p>
                            <p className={`text-[11px] mt-1.5 font-medium whitespace-nowrap ${isSelected ? 'text-[#C9A86C]' : 'text-neutral-400'}`}>
                                ⏱ {e.speed}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
