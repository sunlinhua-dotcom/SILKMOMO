'use client';

import { useId, useState } from 'react';
import { MODELS, BODY_TYPES, SKIN_TONES, PRODUCT_OUTPUT_SIZES, SCENE_OUTPUT_SIZES } from '@/lib/models';
import { Grid3X3, Plus, Trash2, Play, Info } from 'lucide-react';

export interface BatchVariable {
  id: string;
  type: 'model' | 'bodyType' | 'skinTone' | 'outputSize';
  values: string[];
}

export interface BatchConfig {
  variables: BatchVariable[];
  totalCombinations: number;
}

interface BatchOutputMatrixProps {
  moduleType: 'product' | 'scene';
  onStartBatch?: (config: BatchConfig) => void;
  disabled?: boolean;
}

const VARIABLE_TYPES = [
  { type: 'model' as const, label: '模特', icon: '👱' },
  { type: 'bodyType' as const, label: '体型', icon: '🧍' },
  { type: 'skinTone' as const, label: '肤色', icon: '🎨' },
  { type: 'outputSize' as const, label: '输出尺寸', icon: '📐' },
];

function getOptionsForType(type: string, moduleType: string) {
  switch (type) {
    case 'model':
      return MODELS.map(m => ({ value: m.id, label: m.name, sublabel: m.description }));
    case 'bodyType':
      return BODY_TYPES.map(b => ({ value: b.id, label: b.name, sublabel: b.description }));
    case 'skinTone':
      return SKIN_TONES.map(s => ({ value: s.id, label: s.name, sublabel: s.description }));
    case 'outputSize':
      return (moduleType === 'product' ? PRODUCT_OUTPUT_SIZES : SCENE_OUTPUT_SIZES)
        .filter(s => s.id !== 'custom')
        .map(s => ({ value: s.id, label: s.label, sublabel: `${s.width}×${s.height}` }));
    default:
      return [];
  }
}

export function BatchOutputMatrix({ moduleType, onStartBatch, disabled }: BatchOutputMatrixProps) {
  const [variables, setVariables] = useState<BatchVariable[]>([]);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  // 添加变量维度
  const addVariable = (type: BatchVariable['type']) => {
    if (variables.find(v => v.type === type)) return; // 已添加
    setVariables(prev => [...prev, { id: `${type}_${prev.length}`, type, values: [] }]);
  };

  // 移除变量维度
  const removeVariable = (id: string) => {
    setVariables(variables.filter(v => v.id !== id));
  };

  // 切换某个值
  const toggleValue = (variableId: string, value: string) => {
    setVariables(variables.map(v => {
      if (v.id !== variableId) return v;
      const newValues = v.values.includes(value)
        ? v.values.filter(val => val !== value)
        : [...v.values, value];
      return { ...v, values: newValues };
    }));
  };

  // 计算总组合数
  const totalCombinations = variables.reduce((total, v) => {
    return total * Math.max(v.values.length, 1);
  }, variables.length > 0 ? 1 : 0);

  // 可添加的变量类型（排除已添加的）
  const availableTypes = VARIABLE_TYPES.filter(t => !variables.find(v => v.type === t.type));

  const handleStartBatch = () => {
    if (totalCombinations === 0) return;
    onStartBatch?.({
      variables,
      totalCombinations,
    });
  };

  return (
    <div className="bg-surface rounded-2xl border border-border-light overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-2 px-5 py-4 min-h-12 hover:bg-background transition-colors"
      >
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-left">
          <Grid3X3 className="w-4 h-4 text-brand-strong" aria-hidden="true" />
          <span className="text-sm font-medium text-text-secondary">批量输出矩阵</span>
          <span className="text-xs text-muted bg-background px-2 py-0.5 rounded">
            高级
          </span>
          {totalCombinations > 0 && (
            <span className="text-xs font-semibold text-brand-strong">
              {totalCombinations} 种组合
            </span>
          )}
        </div>
        <svg
          aria-hidden="true"
          className={`w-4 h-4 flex-shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div id={panelId} className="px-5 pb-5 pt-2 border-t border-border-light">
          {/* 说明 */}
          <div className="flex items-start gap-2 p-3 bg-background rounded-xl mb-4">
            <Info className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-text-secondary leading-relaxed">
              定义多个变量维度，系统自动组合生成。例如选择 2 个模特 × 3 种肤色 = 6 种组合，每种组合生成一套图。
            </p>
          </div>

          {/* 已添加的变量维度 */}
          <div className="space-y-3 mb-4">
            {variables.map((variable) => {
              const typeInfo = VARIABLE_TYPES.find(t => t.type === variable.type);
              const options = getOptionsForType(variable.type, moduleType);

              return (
                <div key={variable.id} role="group" aria-labelledby={`${panelId}-${variable.id}`} className="border border-border-light rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base" aria-hidden="true">{typeInfo?.icon}</span>
                      <span id={`${panelId}-${variable.id}`} className="text-sm font-medium text-ink">{typeInfo?.label}</span>
                      <span className="text-xs text-muted">
                        已选 {variable.values.length} 个
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVariable(variable.id)}
                      aria-label={`移除${typeInfo?.label}维度`}
                      className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-danger-soft text-muted hover:text-danger transition-colors"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {options.map((opt) => {
                      const isSelected = variable.values.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleValue(variable.id, opt.value)}
                          className={`
                            text-xs px-3 py-2 min-h-10 rounded-lg border transition-all
                            ${isSelected
                              ? 'border-brand-strong bg-brand-strong text-white'
                              : 'border-border text-text-secondary hover:border-brand-strong/60'
                            }
                          `}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 添加变量维度按钮 */}
          {availableTypes.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {availableTypes.map((type) => (
                <button
                  key={type.type}
                  type="button"
                  onClick={() => addVariable(type.type)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 min-h-10 rounded-lg border border-dashed border-border hover:border-brand-strong hover:text-brand-strong text-text-secondary transition-all"
                >
                  <Plus className="w-3 h-3" aria-hidden="true" />
                  <span aria-hidden="true">{type.icon}</span> {type.label}
                </button>
              ))}
            </div>
          )}

          {/* 组合预览 + 开始按钮 */}
          {variables.length > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap p-3 bg-background rounded-xl">
              <div>
                <div className="text-sm font-medium text-ink">
                  总计 {totalCombinations} 种组合
                </div>
                <div className="text-xs text-muted">
                  {variables.map(v => {
                    const typeInfo = VARIABLE_TYPES.find(t => t.type === v.type);
                    return `${v.values.length} ${typeInfo?.label}`;
                  }).join(' × ')}
                </div>
              </div>
              <button
                type="button"
                onClick={handleStartBatch}
                disabled={totalCombinations === 0 || disabled}
                className={`
                  flex items-center gap-2 text-sm font-medium px-4 py-2 min-h-10 rounded-xl transition-colors
                  ${totalCombinations > 0 && !disabled
                    ? 'bg-brand-strong text-white hover:bg-ink'
                    : 'bg-border-light text-muted cursor-not-allowed'
                  }
                `}
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                开始批量生成
              </button>
            </div>
          )}

          {/* 空状态 */}
          {variables.length === 0 && (
            <div className="text-center py-4 text-xs text-muted">
              点击上方按钮添加变量维度，开始批量组合生成
            </div>
          )}
        </div>
      )}
    </div>
  );
}
