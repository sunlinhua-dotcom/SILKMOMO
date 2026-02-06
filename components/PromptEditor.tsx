'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Edit3 } from 'lucide-react';

interface PromptEditorProps {
  defaultPrompt: string;
  customPrompt?: string;
  onChange?: (prompt: string) => void;
  label: string;
}

export function PromptEditor({
  defaultPrompt,
  customPrompt,
  onChange,
  label,
}: PromptEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [value, setValue] = useState(customPrompt || '');
  const [useCustom, setUseCustom] = useState(!!customPrompt);

  const handleToggle = () => setIsExpanded(!isExpanded);

  const handleUseCustomChange = (checked: boolean) => {
    setUseCustom(checked);
    if (checked && !value) {
      setValue(defaultPrompt);
    }
    onChange?.(checked ? value : '');
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (useCustom) {
      onChange?.(newValue);
    }
  };

  return (
    <div className="border-b border-neutral-100 pb-6 last:border-0">
      <div
        className="flex items-center justify-between cursor-pointer py-2"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4 text-neutral-300" />
          <span className="text-sm text-neutral-600">{label}</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-neutral-300" />
        ) : (
          <ChevronDown className="w-4 h-4 text-neutral-300" />
        )}
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => handleUseCustomChange(e.target.checked)}
              className="w-4 h-4 border-neutral-300 rounded text-[#D4AF37] focus:ring-[#D4AF37] focus:ring-offset-0"
            />
            <span className="text-sm text-neutral-600">使用自定义提示词</span>
          </label>

          {useCustom && (
            <textarea
              value={value}
              onChange={handleChange}
              rows={4}
              className="w-full px-4 py-3 text-sm border border-neutral-200 rounded focus:outline-none focus:border-neutral-900 focus:ring-0 resize-none bg-neutral-50"
              placeholder="输入自定义提示词..."
            />
          )}

          {!useCustom && (
            <div className="p-4 bg-neutral-50 rounded text-sm text-neutral-400">
              <p className="font-medium text-neutral-500 mb-1">默认提示词</p>
              <p className="line-clamp-2">{defaultPrompt}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PromptEditorsProps {
  onPromptsChange?: (prompts: Record<string, string>) => void;
}

const PROMPT_LABELS = {
  hero: '头图提示词 (1:1)',
  full_body: '全身照提示词 (3:4)',
  half_body: '半身照提示词 (3:4)',
  close_up: '特写照提示词 (3:4)'
};

export function PromptEditors({ onPromptsChange }: PromptEditorsProps) {
  const [prompts, setPrompts] = useState<Record<string, string>>({});

  const handleChange = (key: string, value: string) => {
    const newPrompts = { ...prompts, [key]: value };
    setPrompts(newPrompts);
    onPromptsChange?.(newPrompts);
  };

  return (
    <div className="space-y-4">
      {Object.entries(PROMPT_LABELS).map(([key, label]) => (
        <PromptEditor
          key={key}
          label={label}
          defaultPrompt={`默认${label.split(' ')[0]}提示词，生成专业的电商模特图...`}
          customPrompt={prompts[key]}
          onChange={(value) => handleChange(key, value)}
        />
      ))}
    </div>
  );
}
