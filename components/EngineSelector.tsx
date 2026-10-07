'use client';

import { useId } from 'react';
import { Check, Sparkles, Zap } from 'lucide-react';
import { useRadioGroup } from './useRadioGroup';

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
    const labelId = useId();
    const { groupProps, itemProps } = useRadioGroup(ENGINES.map((e) => e.id), selected, onSelect);

    if (variant === 'compact') {
        return (
            <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                    <Sparkles className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
                    <span id={labelId} className="text-xs font-medium tracking-widest uppercase text-text-secondary">生图引擎</span>
                </div>
                <div {...groupProps} aria-labelledby={labelId} className="flex flex-wrap gap-2">
                    {ENGINES.map((e) => {
                        const isSelected = e.id === selected;
                        const Icon = e.icon;
                        return (
                            <button
                                key={e.id}
                                type="button"
                                {...itemProps(e.id)}
                                onClick={() => onSelect(e.id)}
                                className={`
                                    cursor-pointer flex items-center gap-2 px-3 py-2 min-h-10 rounded-xl border transition-all duration-200
                                    ${isSelected
                                        ? 'border-brand-strong bg-brand-soft text-ink ring-1 ring-brand-strong'
                                        : 'border-border bg-surface hover:border-brand-strong/60 hover:shadow-sm text-text-secondary'
                                    }
                                `}
                            >
                                <Icon className={`w-4 h-4 ${isSelected ? 'text-brand-strong' : ''}`} strokeWidth={1.5} aria-hidden="true" />
                                <span className="text-xs font-medium whitespace-nowrap">{e.name}</span>
                                <span className={`text-xs whitespace-nowrap ${isSelected ? 'text-text-secondary' : 'text-muted'}`}>
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
                <Sparkles className="w-4 h-4 text-muted" aria-hidden="true" />
                <span id={labelId} className="text-sm font-medium text-text-secondary">选择生图引擎 (Engine)</span>
            </div>
            <div {...groupProps} aria-labelledby={labelId} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ENGINES.map((e) => {
                    const isSelected = e.id === selected;
                    const Icon = e.icon;
                    return (
                        <button
                            key={e.id}
                            type="button"
                            {...itemProps(e.id)}
                            onClick={() => onSelect(e.id)}
                            className={`
                                relative text-left p-4 min-h-10 rounded-xl border transition-all duration-200
                                ${isSelected
                                    ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong'
                                    : 'border-border bg-surface hover:border-brand-strong/60 hover:shadow-sm'
                                }
                            `}
                        >
                            {isSelected && (
                                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-brand-strong flex items-center justify-center">
                                    <Check className="w-3 h-3 text-white" aria-hidden="true" />
                                </div>
                            )}
                            <div className={`w-10 h-10 rounded-xl mb-3 flex items-center justify-center
                                ${isSelected ? 'bg-surface text-brand-strong' : 'bg-background text-muted'}
                            `}>
                                <Icon className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                            </div>
                            <h3 className="font-medium text-sm mb-0.5 text-ink">
                                {e.name}
                            </h3>
                            <p className="text-xs tracking-wider text-muted mb-1.5 font-mono">
                                <span className={isSelected ? 'text-text-secondary' : ''}>{e.sub}</span>
                            </p>
                            <p className="text-xs text-text-secondary leading-relaxed">{e.desc}</p>
                            <p className={`text-xs mt-1.5 font-medium whitespace-nowrap ${isSelected ? 'text-ink' : 'text-muted'}`}>
                                ⏱ {e.speed}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
