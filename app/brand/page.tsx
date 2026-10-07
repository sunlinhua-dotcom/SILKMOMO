'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Save, RotateCcw, Camera, Trees, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
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

// 与 lib/brand-memory.ts 的 BRAND_LIMITS.name 保持一致（该文件依赖 prisma，不能进客户端包）
const NAME_MAX = 64;

const INITIAL_FORM: BrandProfileForm = {
  name: '默认品牌',
  defaultModelId: '',
  defaultBodyType: 'standard',
  defaultSkinTone: 'light',
  defaultModule: 'product',
  defaultEngine: 'gemini',
};

type LoadStatus = 'loading' | 'ready' | 'error';

export default function BrandSettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<BrandProfileForm>(INITIAL_FORM);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoadStatus('loading');
    try {
      const r = await fetch('/api/brand', { cache: 'no-store' });
      if (r.status === 401) {
        router.push('/login');
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data?.profile) throw new Error('响应缺少 profile');
      setForm({
        name: data.profile.name || '默认品牌',
        defaultModelId: data.profile.defaultModelId || '',
        defaultBodyType: (data.profile.defaultBodyType as BrandProfileForm['defaultBodyType']) || 'standard',
        defaultSkinTone: (data.profile.defaultSkinTone as BrandProfileForm['defaultSkinTone']) || 'light',
        defaultModule: (data.profile.defaultModule as BrandProfileForm['defaultModule']) || 'product',
        defaultEngine: data.profile.defaultEngine === 'openai' ? 'openai' : 'gemini',
      });
      setLoadStatus('ready');
    } catch (e) {
      console.error('加载品牌档案失败:', e);
      setLoadStatus('error');
    }
  }, [router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  /** 提交到服务端；成功返回 true。后端 400 的中文 error 原样给用户看。 */
  const persist = async (payload: BrandProfileForm, failPrefix: string): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch('/api/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        router.push('/login');
        return false;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(`${failPrefix}：${err.error || '服务器返回异常，请稍后重试'}`);
        return false;
      }
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 2000);
      return true;
    } catch (e) {
      toast.error(`${failPrefix}：${e instanceof Error ? e.message : '网络错误'}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (loadStatus !== 'ready') return;
    if (await persist(form, '保存失败')) toast.success('品牌偏好已保存');
  };

  const handleReset = async () => {
    if (loadStatus !== 'ready') return;
    const ok = await confirm({
      title: '重置为默认值？',
      message: '这会清空当前的品牌偏好（之后生成时会重新自动学习）。',
      confirmText: '重置',
      danger: true,
    });
    if (!ok) return;
    // 文案承诺"清空品牌偏好"，所以重置必须立即保存到服务端；
    // 成功后才改本地表单，失败时界面仍与服务端一致
    if (await persist(INITIAL_FORM, '重置失败')) {
      setForm(INITIAL_FORM);
      toast.success('已重置为默认值');
    }
  };

  const locked = loadStatus !== 'ready' || saving;

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <PageHeader title="品牌设置" />

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:space-y-10 sm:px-6 sm:py-12">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--color-brand-strong)]" aria-hidden="true" />
            <span className="text-xs uppercase tracking-widest text-[var(--color-brand-strong)]">Brand Memory</span>
          </div>
          <h2 className="font-serif text-2xl tracking-tight text-[var(--color-primary)] sm:text-3xl">默认偏好</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            这里设置的内容会作为主页生成时的默认值。每次手动选择也会被静默记住，下次自动回填。
          </p>
        </div>

        {loadStatus === 'error' && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="flex items-start gap-2 text-sm text-[var(--color-danger)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>品牌档案加载失败。为避免用默认值覆盖你已保存的内容，保存与重置已暂时禁用。</span>
            </p>
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--color-danger)]/40 px-4 text-sm font-medium text-[var(--color-danger)] transition-colors hover:bg-white/60"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              重试
            </button>
          </div>
        )}

        {loadStatus === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]" role="status">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-brand-strong)] border-t-transparent" />
            正在加载你的品牌档案…
          </p>
        )}

        <fieldset
          disabled={locked}
          aria-busy={loadStatus === 'loading'}
          className={`m-0 min-w-0 space-y-8 border-0 p-0 transition-opacity sm:space-y-10 ${
            loadStatus !== 'ready' ? 'opacity-50' : ''
          }`}
        >
          {/* 品牌名称 */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <label
                htmlFor="brand-name"
                className="text-xs font-medium uppercase tracking-widest text-[var(--color-text-secondary)]"
              >
                品牌名称
              </label>
              <span
                className={`num text-xs ${
                  form.name.length >= NAME_MAX ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'
                }`}
                aria-live="polite"
              >
                {form.name.length} / {NAME_MAX}
              </span>
            </div>
            <input
              id="brand-name"
              type="text"
              value={form.name}
              maxLength={NAME_MAX}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="如：SILXINE 主线 / 副牌青涩"
              className="w-full border-0 border-b border-[var(--color-border-light)] bg-transparent px-2 py-3 font-serif text-base text-[var(--color-text)] transition-colors placeholder:text-[var(--color-text-muted)]/70 focus:border-[var(--color-brand-strong)] focus:ring-0"
            />
          </div>

          {/* 默认模式 */}
          <div className="space-y-3" role="group" aria-labelledby="brand-module-label">
            <span
              id="brand-module-label"
              className="block text-xs font-medium uppercase tracking-widest text-[var(--color-text-secondary)]"
            >
              默认模式
            </span>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {(
                [
                  { id: 'product', title: '产品图', sub: '电商主图', Icon: Camera },
                  { id: 'scene', title: '场景图', sub: '生活方式', Icon: Trees },
                ] as const
              ).map(({ id, title, sub, Icon }) => {
                const active = form.defaultModule === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setForm({ ...form, defaultModule: id })}
                    className={`relative flex min-h-14 items-center gap-3 rounded-2xl p-4 transition-all duration-300 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-[var(--color-primary)] text-white shadow-lg'
                        : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-brand-strong)]'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        active ? 'bg-white/10' : 'bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="text-left">
                      <div className="font-serif text-base">{title}</div>
                      <div className={`mt-0.5 text-xs ${active ? 'text-white/75' : 'text-[var(--color-text-muted)]'}`}>
                        {sub}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 默认生图引擎 */}
          <div className="space-y-3">
            <span className="block text-xs font-medium uppercase tracking-widest text-[var(--color-text-secondary)]">
              默认生图引擎
            </span>
            <EngineSelector
              selected={form.defaultEngine}
              onSelect={(engine) => setForm({ ...form, defaultEngine: engine })}
              variant="full"
            />
          </div>

          {/* 默认模特 */}
          <div className="space-y-3">
            <span className="block text-xs font-medium uppercase tracking-widest text-[var(--color-text-secondary)]">
              默认模特
            </span>
            <ModelSelector
              selectedModel={form.defaultModelId}
              onSelect={(id) => setForm({ ...form, defaultModelId: id })}
            />
          </div>

          {/* 默认体型 + 肤色 */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <span className="block text-xs font-medium uppercase tracking-widest text-[var(--color-text-secondary)]">
                默认体型
              </span>
              <BodyTypeSelector
                selectedBodyType={form.defaultBodyType}
                onSelect={(v) => setForm({ ...form, defaultBodyType: v })}
              />
            </div>
            <div className="space-y-3">
              <span className="block text-xs font-medium uppercase tracking-widest text-[var(--color-text-secondary)]">
                默认肤色
              </span>
              <SkinToneSelector
                selectedSkinTone={form.defaultSkinTone}
                onSelect={(v) => setForm({ ...form, defaultSkinTone: v })}
              />
            </div>
          </div>
        </fieldset>

        {/* 操作区 */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border-light)] pt-6">
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={locked}
            className="flex min-h-11 items-center gap-2 px-4 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            重置为默认值
          </button>

          <div className="flex items-center gap-3">
            {savedHint && (
              <span className="animate-fade-in text-xs text-[var(--color-success)]" role="status">
                已保存 ✓
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={locked}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
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
