'use client';

import { useState, useCallback, useRef } from 'react';

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
  // 请求序号：快速"删图→换图"时旧请求的响应后到，会把新图的分析结果覆盖成旧图的。
  // 每次 analyze/reset 自增序号，响应落地前校验是否仍是最新请求。
  const requestSeqRef = useRef(0);

  const analyze = useCallback(async (imageBase64: string, mimeType?: string) => {
    if (!imageBase64) return;
    const seq = ++requestSeqRef.current;

    setAnalysis(prev => ({ ...prev, loading: true, error: undefined }));

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
      });

      if (seq !== requestSeqRef.current) return; // 已被更新的请求 / reset 取代

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
      if (seq !== requestSeqRef.current) return;
      setAnalysis({
        loading: false,
        done: true,
        description: data.description || '',
        keywords: data.keywords || [],
        category: data.category || 'garment',
      });
    } catch {
      if (seq !== requestSeqRef.current) return;
      setAnalysis(prev => ({
        ...prev,
        loading: false,
        done: true,
        error: '分析失败，不影响生成',
      }));
    }
  }, []);

  const reset = useCallback(() => {
    requestSeqRef.current++; // 使在途请求的响应失效
    setAnalysis(INITIAL);
  }, []);

  return { analysis, analyze, reset };
}
