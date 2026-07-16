'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { History, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { UserNav } from '@/components/UserNav';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { ImageUploader } from '@/components/ImageUploader';
import { EngineSelector, type ImageEngine } from '@/components/EngineSelector';
import { GPTQualitySelector } from '@/components/GPTQualitySelector';
import {
  LookbookGarmentSlots,
  type GroupAnalysisState,
  MAX_TOTAL_GARMENTS,
} from '@/components/LookbookGarmentSlots';
import { DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE, SCENE_OUTPUT_SIZES } from '@/lib/models';
import { getGenerationCostFen, type GenerationQuality } from '@/lib/billing-constants';
import type { CompressedImage } from '@/lib/image-compressor';
import { db, migrateLegacyStylePackImages, prepareProjectImageSlot } from '@/lib/db';

// 后端 sceneRefImages 硬上限 20（stream/route.ts validateImageInputs）
const LOOKBOOK_MAX = 20;
const PRODUCT_GROUP_MAX = 8;
const PRODUCT_GROUP_IMAGE_MAX = 4;

type LookbookMode = 'swap' | 'products';
interface ProductGroupDraft {
  id: string;
  label: string;
  images: CompressedImage[];
}

function createProductGroup(): ProductGroupDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label: '',
    images: [],
  };
}

function OutputSizeSelector({
  value,
  onChange,
  customWidth,
  customHeight,
  onCustomSizeChange,
  radioName,
}: {
  value: string;
  onChange: (sizeId: string) => void;
  customWidth: number;
  customHeight: number;
  onCustomSizeChange: (w: number, h: number) => void;
  radioName: string;
}) {
  return (
    <div className="space-y-2">
      {SCENE_OUTPUT_SIZES.map((size) => (
        <label
          key={size.id}
          className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
            value === size.id
              ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.05)]'
              : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
          }`}
        >
          <input
            type="radio"
            name={radioName}
            value={size.id}
            checked={value === size.id}
            onChange={() => onChange(size.id)}
            className="sr-only"
          />
          <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
            value === size.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
          }`}>
            {value === size.id && <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />}
          </div>
          <div className="flex-1">
            <span className="text-sm font-medium text-[var(--color-text)]">{size.label}</span>
            {size.sublabel && <span className="text-xs text-[var(--color-text-muted)] ml-2">{size.sublabel}</span>}
          </div>
          {size.id !== 'custom' && (
            <span className="text-xs text-[var(--color-text-muted)] font-mono">{size.width}×{size.height}</span>
          )}
        </label>
      ))}
      {value === 'custom' && (
        <div className="mt-3 flex items-center gap-3 p-3 bg-[var(--color-background)] rounded-xl">
          <input
            type="number"
            value={customWidth}
            onChange={(e) => onCustomSizeChange(parseInt(e.target.value) || 0, customHeight)}
            placeholder="宽"
            className="w-full text-sm text-center border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <span className="text-[var(--color-text-muted)] text-sm font-medium">×</span>
          <input
            type="number"
            value={customHeight}
            onChange={(e) => onCustomSizeChange(customWidth, parseInt(e.target.value) || 0)}
            placeholder="高"
            className="w-full text-sm text-center border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <span className="text-xs text-[var(--color-text-muted)]">px</span>
        </div>
      )}
    </div>
  );
}

export default function LookbookStudio() {
  // ── 登录 / 余额 ──
  const [currentUser, setCurrentUser] = useState<{ balanceFen: number } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (alive) { if (d.user) setCurrentUser(d.user); setAuthChecked(true); } })
      .catch(() => { if (alive) setAuthChecked(true); });
    return () => { alive = false; };
  }, []);

  // ── 输入 state（与首页产品图工作台完全隔离：独立路由=独立组件树） ──
  const [mode, setMode] = useState<LookbookMode>('swap');
  const [lookbookImages, setLookbookImages] = useState<CompressedImage[]>([]); // → scene_ref
  const [groupAnalysis, setGroupAnalysis] = useState<GroupAnalysisState>({
    loading: false, done: false, primaryCategories: [], accessories: [], garmentsWornByPerson: false,
  });
  const [groupGarments, setGroupGarments] = useState<Record<string, CompressedImage[]>>({}); // 品类→图 → product
  const [accessoryImages, setAccessoryImages] = useState<CompressedImage[]>([]);
  const [singleSceneImages, setSingleSceneImages] = useState<CompressedImage[]>([]);
  const [productGroups, setProductGroups] = useState<ProductGroupDraft[]>([createProductGroup()]);
  // 组图默认走 GPT 图像编辑：只有 edit 路径能冻结原场景+姿势，Gemini 会重绘
  const [selectedEngine, setSelectedEngine] = useState<ImageEngine>('openai');
  const [selectedQuality, setSelectedQuality] = useState<GenerationQuality>('medium');
  const [sceneOutputSize, setSceneOutputSize] = useState('hero_desktop');
  const [sceneCustomW, setSceneCustomW] = useState(1080);
  const [sceneCustomH, setSceneCustomH] = useState(1350);
  const [projectName, setProjectName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const groupGarmentImages = Object.values(groupGarments).flat();
  const validProductGroups = productGroups.filter(g => g.images.length > 0);
  const handleGroupGarmentChange = (category: string, imgs: CompressedImage[]) => {
    setGroupGarments(prev => ({ ...prev, [category]: imgs }));
  };
  const updateProductGroup = (id: string, patch: Partial<ProductGroupDraft>) => {
    setProductGroups(prev => prev.map(group => group.id === id ? { ...group, ...patch } : group));
  };
  const addProductGroup = () => {
    setProductGroups(prev => prev.length >= PRODUCT_GROUP_MAX ? prev : [...prev, createProductGroup()]);
  };
  const removeProductGroup = (id: string) => {
    setProductGroups(prev => prev.length <= 1 ? prev : prev.filter(group => group.id !== id));
  };

  // ── 自动识别（防抖 + 指纹去重 + 竞态守卫） ──
  const seqRef = useRef(0);
  const lastSigRef = useRef('');
  const sigOf = (imgs: CompressedImage[]) =>
    `${imgs.length}:${imgs[0]?.base64.length || 0}:${imgs[imgs.length - 1]?.base64.length || 0}`;

  const runAnalysis = useCallback(async (images: CompressedImage[]) => {
    if (images.length === 0) return;
    const seq = ++seqRef.current;
    setGroupAnalysis(prev => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: images.map(img => ({ data: img.base64, mimeType: img.mimeType })) }),
      });
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setGroupAnalysis(prev => ({ ...prev, loading: false, done: true, garmentsWornByPerson: false, error: 'AI 识别暂时不可用，可直接在下方通用槽上传服装' }));
        return; // 失败不烧指纹：同一组图还能自动重试一次
      }
      const data = await res.json();
      if (seq !== seqRef.current) return;
      // 只在成功落地后写指纹（失败/竞态不写），使失败后同一 lookbook 仍能被自动重试
      lastSigRef.current = sigOf(images);
      setGroupAnalysis({
        loading: false, done: true,
        primaryCategories: Array.isArray(data.primaryCategories) ? data.primaryCategories : [],
        accessories: Array.isArray(data.accessories) ? data.accessories : [],
        garmentsWornByPerson: data.garmentsWornByPerson === true,
      });
    } catch {
      if (seq !== seqRef.current) return;
      setGroupAnalysis(prev => ({ ...prev, loading: false, done: true, garmentsWornByPerson: false, error: '识别失败，可点「重新识别」或直接在下方通用槽上传' }));
    }
  }, []);

  const reanalyze = () => { lastSigRef.current = ''; runAnalysis(lookbookImages); };

  // lookbook 变化 → 防抖自动识别（指纹不变则跳过，避免重复扣费）
  useEffect(() => {
    if (lookbookImages.length === 0) return;
    if (sigOf(lookbookImages) === lastSigRef.current) return;
    const t = setTimeout(() => { runAnalysis(lookbookImages); }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookbookImages]);

  // lookbook 变化让在途识别响应失效（防 stale 覆盖）
  const onLookbookChange = (imgs: CompressedImage[]) => {
    setLookbookImages(imgs);
    seqRef.current++;
    setGroupAnalysis(prev => (prev.done || prev.loading)
      ? { loading: false, done: false, primaryCategories: [], accessories: [], garmentsWornByPerson: false }
      : prev);
  };

  // ── 校验 + 成本 ──
  const lookbookOk = lookbookImages.length >= 1 && lookbookImages.length <= LOOKBOOK_MAX;
  const garmentsOk = groupGarmentImages.length >= 1 && groupGarmentImages.length <= MAX_TOTAL_GARMENTS;
  const singleSceneOk = singleSceneImages.length === 1;
  const productGroupsOk =
    validProductGroups.length >= 1 &&
    validProductGroups.length <= PRODUCT_GROUP_MAX &&
    validProductGroups.every(group => group.images.length >= 1 && group.images.length <= PRODUCT_GROUP_IMAGE_MAX);
  const targetCount = mode === 'products' ? validProductGroups.length : lookbookImages.length;
  const pricePerImageFen = getGenerationCostFen(selectedEngine, selectedQuality);
  const canGenerate = mode === 'products'
    ? singleSceneOk && productGroupsOk
    : lookbookOk && garmentsOk;
  const totalCostFen = Math.max(1, targetCount) * pricePerImageFen;
  const isBalanceSufficient = currentUser ? currentUser.balanceFen >= totalCostFen : false;
  const diffYuan = currentUser ? ((totalCostFen - currentUser.balanceFen) / 100).toFixed(2) : '0.00';

  const detectedCount = groupAnalysis.primaryCategories.length + groupAnalysis.accessories.length;

  // ── 生成：写同一 SilkMomoDB 再跳 /task/[id]（复用已建好的组图 SSE 内核） ──
  const handleGenerate = async () => {
    if (!canGenerate || isGenerating || !currentUser) return;
    if (!isBalanceSufficient) return;
    setIsGenerating(true);
    try {
      await migrateLegacyStylePackImages();
      const productModeLabels = validProductGroups.map((group, index) => group.label.trim() || `产品 ${index + 1}`);
      const projectId = await db.projects.add({
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending',
        name: projectName.trim() || (mode === 'products'
          ? `同景换品 ${new Date().toLocaleString('zh-CN')}`
          : `组图·换装 ${new Date().toLocaleString('zh-CN')}`),
        moduleType: 'scene',
        bodyType: DEFAULT_BODY_TYPE.id,
        skinTone: DEFAULT_SKIN_TONE.id,
        engine: selectedEngine,
        generationQuality: selectedEngine === 'openai' ? selectedQuality : undefined,
        sceneOutputSize,
        sceneHasModel: true,
        sceneGroup: true,
        sceneGroupMode: mode,
        sceneGroupCategories: mode === 'products'
          ? JSON.stringify(productModeLabels)
          : JSON.stringify(
              Object.keys(groupGarments).filter(k => (groupGarments[k]?.length || 0) > 0),
            ),
        customWidth: sceneOutputSize === 'custom' ? sceneCustomW : undefined,
        customHeight: sceneOutputSize === 'custom' ? sceneCustomH : undefined,
      });

      await prepareProjectImageSlot(projectId as number);

      if (mode === 'products') {
        for (const img of singleSceneImages) {
          await db.images.add({ projectId, type: 'scene_ref', data: img.base64, mimeType: img.mimeType });
        }
        for (const [groupIdx, group] of validProductGroups.entries()) {
          const label = group.label.trim() || `产品 ${groupIdx + 1}`;
          for (const img of group.images) {
            await db.images.add({
              projectId,
              type: 'product',
              data: img.base64,
              mimeType: img.mimeType,
              groupIndex: groupIdx + 1,
              prompt: label,
            });
          }
        }
      } else {
        for (const img of groupGarmentImages) {
          await db.images.add({ projectId, type: 'product', data: img.base64, mimeType: img.mimeType });
        }
        for (const img of lookbookImages) {
          await db.images.add({ projectId, type: 'scene_ref', data: img.base64, mimeType: img.mimeType });
        }
        for (const img of accessoryImages) {
          await db.images.add({ projectId, type: 'accessory', data: img.base64, mimeType: img.mimeType });
        }
      }

      window.location.href = `/task/${projectId}`;
    } catch (e) {
      console.error('组图生成准备失败:', e);
      setIsGenerating(false);
    }
  };

  // ── 未登录兜底 ──
  if (authChecked && !currentUser) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <Sparkles className="w-8 h-8 text-[var(--color-accent)] mx-auto" aria-hidden="true" />
          <p className="text-sm text-[var(--color-text-secondary)]">请先登录后使用「组图·换装」</p>
          <Link href="/login" className="inline-block btn-primary px-6 py-2.5 text-sm">去登录</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* 顶部导航（与首页一致） */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]/30">
        <div className="max-w-[85rem] mx-auto px-4 sm:px-6 lg:px-12">
          <div className="flex items-center justify-between h-14 sm:h-20">
            <Link href="/" className="flex items-center gap-2.5 sm:gap-4 group min-w-0">
              <div className="w-8 h-8 sm:w-11 sm:h-11 flex-shrink-0 flex items-center justify-center">
                <Logo width={32} height={32} className="sm:w-[44px] sm:h-[44px]" />
              </div>
              <div className="min-w-0">
                <span className="font-serif text-base sm:text-2xl tracking-[0.1em] sm:tracking-[0.15em] text-[var(--color-primary)]">SILXINE</span>
                <span className="hidden sm:block text-[10px] tracking-[0.25em] uppercase text-[var(--color-text-muted)] mt-0.5">Maison de Création Digitale</span>
              </div>
            </Link>
            <div className="flex items-center gap-3 sm:gap-6 flex-shrink-0">
              <Link href="/tasks" className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] tracking-widest uppercase text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors duration-300">
                <History className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                <span className="hidden sm:inline">Archives</span>
              </Link>
              <UserNav />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-24 space-y-6 sm:space-y-8">
        {/* 双工作台入口 */}
        <WorkspaceSwitcher active="lookbook" />

        {/* Hero */}
        <div className="text-center pt-2">
          <h1 className="font-serif text-2xl sm:text-3xl text-[var(--color-primary)] tracking-wide">上传你的一组照片，我们识别并换装</h1>
          <p className="text-xs sm:text-sm text-[var(--color-text-muted)] mt-2 leading-relaxed max-w-xl mx-auto">
            上传几张就出几张；每张冻结原场景与姿势，只把服装换成你上传的款、并换成同一个全新模特。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[var(--color-surface)] p-1 border border-[var(--color-border-light)]">
          {([
            { id: 'swap' as const, label: '换装 · N景1品' },
            { id: 'products' as const, label: '同景换品 · 1景N品' },
          ]).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMode(item.id)}
              className={`rounded-xl px-3 py-3 text-xs sm:text-sm font-medium transition-colors ${
                mode === item.id
                  ? 'bg-[var(--color-accent)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {mode === 'swap' ? (
          <>
            {/* ① 整组 lookbook */}
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[rgba(201,168,108,0.2)]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">① 整组 lookbook</h3>
                {lookbookImages.length > 0 && (
                  <span className="text-xs text-[var(--color-accent)] font-medium">已传 {lookbookImages.length} 张 → 出 {lookbookImages.length} 张</span>
                )}
              </div>
              <ImageUploader
                title="lookbook 参考图"
                description={`上传整组场景主图（最多 ${LOOKBOOK_MAX} 张，上传几张最后就出几张）。系统会自动识别其中的服装与附件。`}
                required
                maxFiles={LOOKBOOK_MAX}
                images={lookbookImages}
                onImagesChange={onLookbookChange}
                variant="gold"
              />
              {lookbookImages.length > LOOKBOOK_MAX && (
                <p className="mt-2 text-xs text-amber-600">最多 {LOOKBOOK_MAX} 张，请减少后再生成。</p>
              )}
            </div>

            {/* ②③④⑤⑥ 识别 + 品类槽 + 附件 + 模特 + 尺寸 */}
            <LookbookGarmentSlots
              lookbookCount={lookbookImages.length}
              groupAnalysis={groupAnalysis}
              onReanalyze={reanalyze}
              groupGarments={groupGarments}
              onGroupGarmentChange={handleGroupGarmentChange}
              accessoryImages={accessoryImages}
              onAccessoryImagesChange={setAccessoryImages}
              outputSize={sceneOutputSize}
              onOutputSizeChange={setSceneOutputSize}
              customWidth={sceneCustomW}
              customHeight={sceneCustomH}
              onCustomSizeChange={(w, h) => { setSceneCustomW(w); setSceneCustomH(h); }}
              garmentsWornByPerson={groupAnalysis.garmentsWornByPerson === true}
            />
          </>
        ) : (
          <>
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[rgba(201,168,108,0.2)]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">① 场景参考图</h3>
                {singleSceneImages.length === 1 && (
                  <span className="text-xs text-[var(--color-accent)] font-medium">同一场景将复用到每个产品组</span>
                )}
              </div>
              <ImageUploader
                title="场景参考图"
                description="上传 1 张带人物的场景图；所有结果都会保留这个场景、机位和姿势，只替换为不同产品组。"
                required
                maxFiles={1}
                images={singleSceneImages}
                onImagesChange={setSingleSceneImages}
                variant="gold"
              />
            </div>

            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[rgba(201,168,108,0.2)] space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">② 产品组</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">每组会生成 1 张结果；每组可上传 1-4 张产品参考图，可填写组名。</p>
                </div>
                <span className="shrink-0 text-xs text-[var(--color-text-muted)] tabular-nums">
                  {validProductGroups.length}/{PRODUCT_GROUP_MAX} 组
                </span>
              </div>

              {productGroups.map((group, index) => (
                <div key={group.id} className="rounded-2xl border border-[var(--color-border-light)] p-4 space-y-3 bg-[var(--color-background)]/40">
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={group.label}
                      onChange={(e) => updateProductGroup(group.id, { label: e.target.value })}
                      placeholder={`产品 ${index + 1} 组名（选填）`}
                      aria-label={`产品 ${index + 1} 组名`}
                      className="flex-1 text-sm border border-[var(--color-border-light)] rounded-xl px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => removeProductGroup(group.id)}
                      disabled={productGroups.length <= 1}
                      className="w-10 h-10 inline-flex items-center justify-center rounded-xl border border-[var(--color-border-light)] text-[var(--color-text-muted)] hover:text-red-500 hover:border-red-200 disabled:opacity-40 disabled:hover:text-[var(--color-text-muted)] disabled:hover:border-[var(--color-border-light)]"
                      aria-label={`删除产品 ${index + 1}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  <ImageUploader
                    title={`产品 ${index + 1}`}
                    description={`上传本组产品图，最多 ${PRODUCT_GROUP_IMAGE_MAX} 张`}
                    required
                    maxFiles={PRODUCT_GROUP_IMAGE_MAX}
                    images={group.images}
                    onImagesChange={(images) => updateProductGroup(group.id, { images })}
                    variant="gold"
                  />
                  {group.images.length > PRODUCT_GROUP_IMAGE_MAX && (
                    <p className="text-xs text-amber-600">每组最多 {PRODUCT_GROUP_IMAGE_MAX} 张，请减少后再生成。</p>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addProductGroup}
                disabled={productGroups.length >= PRODUCT_GROUP_MAX}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 disabled:hover:border-[var(--color-border)] disabled:hover:text-[var(--color-text-secondary)]"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                添加产品组
              </button>

              {!productGroupsOk && (
                <p className="text-xs text-amber-600">请至少保留 1 个产品组；每组上传 1-4 张，最多 {PRODUCT_GROUP_MAX} 组。</p>
              )}
            </div>

            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">③ 模特</h3>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                每张都使用<span className="text-[var(--color-accent)] font-medium">同一个全新模特</span>，并保持场景图中的姿势、机位和情绪一致。
              </p>
            </div>

            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">④ 输出尺寸</h3>
              <OutputSizeSelector
                value={sceneOutputSize}
                onChange={setSceneOutputSize}
                customWidth={sceneCustomW}
                customHeight={sceneCustomH}
                onCustomSizeChange={(w, h) => { setSceneCustomW(w); setSceneCustomH(h); }}
                radioName="productsOutputSize"
              />
            </div>
          </>
        )}

        {/* 引擎（组图默认 GPT 图像编辑以冻结场景） */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">生图引擎</h3>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">默认 GPT 图像编辑（能冻结原场景与姿势，较慢）；Gemini 更快但不保证冻结。</p>
          <EngineSelector selected={selectedEngine} onSelect={setSelectedEngine} variant="compact" />
          {selectedEngine === 'openai' && (
            <div className="mt-4">
              <GPTQualitySelector value={selectedQuality} onChange={setSelectedQuality} variant="compact" />
            </div>
          )}
        </div>

        {/* 项目名（选填） */}
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="项目名称（选填）…"
          aria-label="项目名称"
          className="w-full text-sm border-0 border-b border-[var(--color-border-light)] focus:border-[var(--color-accent)] focus:ring-0 px-2 py-3 bg-transparent transition-colors"
        />

        {/* ⑦ 摘要 + 生成 CTA */}
        <div className="sticky bottom-0 pt-2 pb-4 bg-gradient-to-t from-[var(--color-background)] via-[var(--color-background)] to-transparent">
          <p className="text-xs text-[var(--color-text-muted)] text-center mb-2">
            {mode === 'swap' ? (
              <>
                {groupAnalysis.done && detectedCount > 0 ? `识别到 ${detectedCount} 件 · ` : ''}
                已上传 {Object.keys(groupGarments).filter(k => (groupGarments[k]?.length || 0) > 0).length} 类主品 · 将生成 {lookbookImages.length} 张
              </>
            ) : (
              <>已上传 {validProductGroups.length} 个产品组 · 将生成 {validProductGroups.length} 张</>
            )}
          </p>
          <button
            onClick={isBalanceSufficient ? handleGenerate : undefined}
            disabled={isGenerating || !currentUser || (isBalanceSufficient && !canGenerate)}
            className={`w-full flex items-center justify-center gap-2 rounded-xl py-4 text-sm font-medium transition-all duration-300 ${
              !isBalanceSufficient && currentUser
                ? 'bg-gradient-to-r from-gray-400 to-[var(--color-accent)]/80 text-white'
                : 'btn-primary'
            } ${(isGenerating || (isBalanceSufficient && !canGenerate)) ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {isGenerating ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>准备中…</span>
              </>
            ) : !currentUser ? (
              <span>加载中…</span>
            ) : !isBalanceSufficient ? (
              <Link href="/billing" className="flex items-center gap-2">
                <span>余额不足（差 ¥{diffYuan}）· 去充值</span>
              </Link>
            ) : (
              <>
                <Wand2 className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                <span>
                  {mode === 'products'
                    ? `生成 ${validProductGroups.length} 张同景换品图`
                    : `生成 ${lookbookImages.length} 张换装图`}
                  （¥{(totalCostFen / 100).toFixed(2)}）
                </span>
              </>
            )}
          </button>
          {!canGenerate && currentUser && isBalanceSufficient && (
            <p className="text-[11px] text-[var(--color-text-muted)] text-center mt-2">
              {mode === 'products'
                ? singleSceneImages.length === 0
                  ? '先上传 1 张场景参考图'
                  : validProductGroups.length === 0
                    ? '至少添加 1 个产品组'
                    : '每个产品组需上传 1-4 张产品图'
                : lookbookImages.length === 0
                  ? '先上传 lookbook'
                  : groupGarmentImages.length === 0
                    ? '至少上传一件要换上的服装'
                    : lookbookImages.length > LOOKBOOK_MAX
                      ? `lookbook 最多 ${LOOKBOOK_MAX} 张`
                      : `主品图合计最多 ${MAX_TOTAL_GARMENTS} 张`}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
