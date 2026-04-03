'use client';

import { useState, useCallback } from 'react';

export interface ProductAnalysis {
  loading: boolean;
  done: boolean;
  description: string;
  keywords: string[];
  category: string;
  error?: string;
}

const INITIAL: ProductAnalysis = {
  loading: false,
  done: false,
  description: '',
  keywords: [],
  category: '',
};

/**
 * AI 产品分析钩子
 * 上传产品图后自动调 Flash Lite 分析产品特征
 * 结果注入到 prompt 中提升生成精准度
 */
export function useProductAnalysis() {
  const [analysis, setAnalysis] = useState<ProductAnalysis>(INITIAL);

  const analyze = useCallback(async (imageBase64: string) => {
    if (!imageBase64 || analysis.loading) return;

    setAnalysis(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      });

      if (!res.ok) {
        setAnalysis(prev => ({
          ...prev,
          loading: false,
          done: true,
          error: 'AI 分析暂时不可用',
        }));
        return;
      }

      const data = await res.json();
      setAnalysis({
        loading: false,
        done: true,
        description: data.description || '',
        keywords: data.keywords || [],
        category: data.category || 'garment',
      });
    } catch {
      setAnalysis(prev => ({
        ...prev,
        loading: false,
        done: true,
        error: '分析失败，不影响生成',
      }));
    }
  }, [analysis.loading]);

  const reset = useCallback(() => {
    setAnalysis(INITIAL);
  }, []);

  return { analysis, analyze, reset };
}
