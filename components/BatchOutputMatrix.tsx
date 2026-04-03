'use client';

import { useState } from 'react';
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
    <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border-light)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--color-background)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Grid3X3 className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">批量输出矩阵</span>
          <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-0.5 rounded">
            高级
          </span>
          {totalCombinations > 0 && (
            <span className="text-xs font-semibold text-[var(--color-accent)]">
              {totalCombinations} 种组合
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-2 border-t border-[var(--color-border-light)]">
          {/* 说明 */}
          <div className="flex items-start gap-2 p-3 bg-[var(--color-background)] rounded-xl mb-4">
            <Info className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
              定义多个变量维度，系统自动组合生成。例如选择 2 个模特 × 3 种肤色 = 6 种组合，每种组合生成一套图。
            </p>
          </div>

          {/* 已添加的变量维度 */}
          <div className="space-y-3 mb-4">
            {variables.map((variable) => {
              const typeInfo = VARIABLE_TYPES.find(t => t.type === variable.type);
              const options = getOptionsForType(variable.type, moduleType);

              return (
                <div key={variable.id} className="border border-[var(--color-border-light)] rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{typeInfo?.icon}</span>
                      <span className="text-sm font-medium text-[var(--color-text)]">{typeInfo?.label}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        已选 {variable.values.length} 个
                      </span>
                    </div>
                    <button
                      onClick={() => removeVariable(variable.id)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {options.map((opt) => {
                      const isSelected = variable.values.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => toggleValue(variable.id, opt.value)}
                          className={`
                            text-xs px-2.5 py-1.5 rounded-lg border transition-all
                            ${isSelected
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                              : 'border-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:border-[var(--color-border)]'
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
                  onClick={() => addVariable(type.type)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] text-[var(--color-text-muted)] transition-all"
                >
                  <Plus className="w-3 h-3" />
                  {type.icon} {type.label}
                </button>
              ))}
            </div>
          )}

          {/* 组合预览 + 开始按钮 */}
          {variables.length > 0 && (
            <div className="flex items-center justify-between p-3 bg-[var(--color-background)] rounded-xl">
              <div>
                <div className="text-sm font-medium text-[var(--color-text)]">
                  总计 {totalCombinations} 种组合
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {variables.map(v => {
                    const typeInfo = VARIABLE_TYPES.find(t => t.type === v.type);
                    return `${v.values.length} ${typeInfo?.label}`;
                  }).join(' × ')}
                </div>
              </div>
              <button
                onClick={handleStartBatch}
                disabled={totalCombinations === 0 || disabled}
                className={`
                  flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-colors
                  ${totalCombinations > 0 && !disabled
                    ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-dark)]'
                    : 'bg-[var(--color-border-light)] text-[var(--color-text-muted)] cursor-not-allowed'
                  }
                `}
              >
                <Play className="w-4 h-4" />
                开始批量生成
              </button>
            </div>
          )}

          {/* 空状态 */}
          {variables.length === 0 && (
            <div className="text-center py-4 text-xs text-[var(--color-text-muted)]">
              点击上方按钮添加变量维度，开始批量组合生成
            </div>
          )}
        </div>
      )}
    </div>
  );
}
