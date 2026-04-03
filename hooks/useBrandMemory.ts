'use client';

import { useState, useEffect } from 'react';

export interface BrandPreferences {
  loaded: boolean;
  hasProfile: boolean;
  defaultModelId: string;
  defaultBodyType: 'slim' | 'standard' | 'curvy';
  defaultSkinTone: 'light' | 'medium' | 'deep';
  defaultModule: 'product' | 'scene';
  defaultAspectRatio: string;
  brandName: string;
}

const DEFAULT_PREFS: BrandPreferences = {
  loaded: false,
  hasProfile: false,
  defaultModelId: '',
  defaultBodyType: 'standard',
  defaultSkinTone: 'light',
  defaultModule: 'product',
  defaultAspectRatio: '3:4',
  brandName: '',
};

/**
 * 品牌记忆钩子
 * 首次加载时从 /api/brand 拉取用户偏好，自动回填表单
 * 如果用户未登录或无品牌配置则使用默认值
 */
export function useBrandMemory() {
  const [prefs, setPrefs] = useState<BrandPreferences>(DEFAULT_PREFS);

  useEffect(() => {
    let cancelled = false;

    async function loadBrandProfile() {
      try {
        const res = await fetch('/api/brand');
        if (!res.ok) {
          setPrefs({ ...DEFAULT_PREFS, loaded: true });
          return;
        }

        const data = await res.json();
        const p = data.profile;

        if (!cancelled && p) {
          setPrefs({
            loaded: true,
            hasProfile: true,
            defaultModelId: p.defaultModelId || '',
            defaultBodyType: (p.defaultBodyType as 'slim' | 'standard' | 'curvy') || 'standard',
            defaultSkinTone: (p.defaultSkinTone as 'light' | 'medium' | 'deep') || 'light',
            defaultModule: (p.defaultModule as 'product' | 'scene') || 'product',
            defaultAspectRatio: p.defaultAspectRatio || '3:4',
            brandName: p.name || '',
          });
        }
      } catch {
        if (!cancelled) {
          setPrefs({ ...DEFAULT_PREFS, loaded: true });
        }
      }
    }

    loadBrandProfile();
    return () => { cancelled = true; };
  }, []);

  return prefs;
}
