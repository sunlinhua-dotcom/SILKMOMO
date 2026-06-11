'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, RotateCcw, Camera, Trees, Sparkles } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { ModelSelector } from '@/components/ModelSelector';
import { BodyTypeSelector } from '@/components/BodyTypeSelector';
import { SkinToneSelector } from '@/components/SkinToneSelector';
import { EngineSelector, type ImageEngine } from '@/components/EngineSelector';

interface BrandProfileForm {
  name: string;
  defaultModelId: string;
  defaultBodyType: 'slim' | 'standard' | 'curvy';
  defaultSkinTone: 'light' | 'medium' | 'deep';
  defaultModule: 'product' | 'scene';
  defaultEngine: ImageEngine;
}

const INITIAL_FORM: BrandProfileForm = {
  name: '默认品牌',
  defaultModelId: '',
  defaultBodyType: 'standard',
  defaultSkinTone: 'light',
  defaultModule: 'product',
  defaultEngine: 'gemini',
};

export default function BrandSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<BrandProfileForm>(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    fetch('/api/brand')
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/login');
          return null;
        }
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.profile) {
          setForm({
            name: data.profile.name || '默认品牌',
            defaultModelId: data.profile.defaultModelId || '',
            defaultBodyType: (data.profile.defaultBodyType as BrandProfileForm['defaultBodyType']) || 'standard',
            defaultSkinTone: (data.profile.defaultSkinTone as BrandProfileForm['defaultSkinTone']) || 'light',
            defaultModule: (data.profile.defaultModule as BrandProfileForm['defaultModule']) || 'product',
            defaultEngine: data.profile.defaultEngine === 'openai' ? 'openai' : 'gemini',
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`保存失败: ${err.error || res.statusText}`);
        return;
      }
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 2000);
    } catch (e) {
      alert(`保存失败: ${e instanceof Error ? e.message : '网络错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('确定重置为默认值？这会清空当前的品牌偏好（之后生成时会重新自动学习）。')) return;
    // 文案承诺"清空品牌偏好"，所以重置必须立即保存到服务端，
    // 只重置本地表单的话用户离开页面后服务端偏好原封不动
    setForm(INITIAL_FORM);
    setSaving(true);
    try {
      const res = await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(INITIAL_FORM),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`重置失败: ${err.error || res.statusText}`);
        return;
      }
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 2000);
    } catch (e) {
      alert(`重置失败: ${e instanceof Error ? e.message : '网络错误'}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text)] transition-colors" />
            <Logo width={32} height={32} />
            <span className="text-lg font-semibold tracking-tight">SILKMOMO</span>
          </Link>
          <h1 className="text-sm font-medium text-[var(--color-text-secondary)]">品牌设置</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-10">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="text-[10px] tracking-widest uppercase text-[var(--color-accent)]">Brand Memory</span>
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-[var(--color-primary)] tracking-tight">默认偏好</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            这里设置的内容会作为主页生成时的默认值。每次手动选择也会被静默记住，下次自动回填。
          </p>
        </div>

        {/* 品牌名称 */}
        <div className="space-y-2">
          <label className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">品牌名称</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="如：SILKMOMO 主线 / 副牌青涩"
            className="w-full text-base font-serif text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/50 border-0 border-b border-[var(--color-border-light)] focus:border-[var(--color-accent)] focus:ring-0 px-2 py-3 bg-transparent transition-colors"
          />
        </div>

        {/* 默认模式 */}
        <div className="space-y-3">
          <label className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">默认模式</label>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <button
              onClick={() => setForm({ ...form, defaultModule: 'product' })}
              className={`relative flex items-center gap-3 p-4 rounded-2xl transition-all duration-300 ${
                form.defaultModule === 'product'
                  ? 'bg-[#3D2E20] text-white shadow-lg'
                  : 'bg-[#FAFAFA] border border-transparent hover:border-[var(--color-border)] text-[var(--color-text)]'
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                form.defaultModule === 'product' ? 'bg-white/10' : 'bg-white shadow-sm text-[var(--color-primary)]'
              }`}>
                <Camera className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="font-serif text-base">产品图</div>
                <div className={`text-[10px] mt-0.5 ${form.defaultModule === 'product' ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>电商主图</div>
              </div>
            </button>

            <button
              onClick={() => setForm({ ...form, defaultModule: 'scene' })}
              className={`relative flex items-center gap-3 p-4 rounded-2xl transition-all duration-300 ${
                form.defaultModule === 'scene'
                  ? 'bg-[#3D2E20] text-white shadow-lg'
                  : 'bg-[#FAFAFA] border border-transparent hover:border-[var(--color-border)] text-[var(--color-text)]'
              }`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                form.defaultModule === 'scene' ? 'bg-white/10' : 'bg-white shadow-sm text-[var(--color-primary)]'
              }`}>
                <Trees className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="font-serif text-base">场景图</div>
                <div className={`text-[10px] mt-0.5 ${form.defaultModule === 'scene' ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>生活方式</div>
              </div>
            </button>
          </div>
        </div>

        {/* 默认生图引擎 */}
        <div className="space-y-3">
          <label className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">默认生图引擎</label>
          <EngineSelector
            selected={form.defaultEngine}
            onSelect={(engine) => setForm({ ...form, defaultEngine: engine })}
            variant="full"
          />
        </div>

        {/* 默认模特 */}
        <div className="space-y-3">
          <label className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">默认模特</label>
          <ModelSelector
            selectedModel={form.defaultModelId}
            onSelect={(id) => setForm({ ...form, defaultModelId: id })}
          />
        </div>

        {/* 默认体型 + 肤色 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">默认体型</label>
            <BodyTypeSelector
              selectedBodyType={form.defaultBodyType}
              onSelect={(v) => setForm({ ...form, defaultBodyType: v })}
            />
          </div>
          <div className="space-y-3">
            <label className="text-xs font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">默认肤色</label>
            <SkinToneSelector
              selectedSkinTone={form.defaultSkinTone}
              onSelect={(v) => setForm({ ...form, defaultSkinTone: v })}
            />
          </div>
        </div>

        {/* 操作区 */}
        <div className="flex items-center justify-between gap-4 pt-6 border-t border-[var(--color-border-light)]">
          <button
            onClick={handleReset}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" />
            重置为默认值
          </button>

          <div className="flex items-center gap-3">
            {savedHint && (
              <span className="text-xs text-[var(--color-accent)] animate-fade-in">已保存 ✓</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" strokeWidth={1.5} />
                  <span>保存</span>
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
