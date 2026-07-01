'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { History, Sparkles, Wand2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { UserNav } from '@/components/UserNav';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { ImageUploader } from '@/components/ImageUploader';
import { EngineSelector, type ImageEngine } from '@/components/EngineSelector';
import {
  LookbookGarmentSlots,
  type GroupAnalysisState,
  MAX_TOTAL_GARMENTS,
} from '@/components/LookbookGarmentSlots';
import { DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE } from '@/lib/models';
import type { CompressedImage } from '@/lib/image-compressor';
import { db, migrateLegacyStylePackImages, prepareProjectImageSlot } from '@/lib/db';

// 后端 sceneRefImages 硬上限 20（stream/route.ts validateImageInputs）
const LOOKBOOK_MAX = 20;
const PRICE_PER_IMAGE_FEN = 65;

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
  const [lookbookImages, setLookbookImages] = useState<CompressedImage[]>([]); // → scene_ref
  const [groupAnalysis, setGroupAnalysis] = useState<GroupAnalysisState>({
    loading: false, done: false, primaryCategories: [], accessories: [],
  });
  const [groupGarments, setGroupGarments] = useState<Record<string, CompressedImage[]>>({}); // 品类→图 → product
  const [accessoryImages, setAccessoryImages] = useState<CompressedImage[]>([]);
  // 组图默认走 GPT 图像编辑：只有 edit 路径能冻结原场景+姿势，Gemini 会重绘
  const [selectedEngine, setSelectedEngine] = useState<ImageEngine>('openai');
  const [sceneOutputSize, setSceneOutputSize] = useState('hero_desktop');
  const [sceneCustomW, setSceneCustomW] = useState(1080);
  const [sceneCustomH, setSceneCustomH] = useState(1350);
  const [projectName, setProjectName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const groupGarmentImages = Object.values(groupGarments).flat();
  const handleGroupGarmentChange = (category: string, imgs: CompressedImage[]) => {
    setGroupGarments(prev => ({ ...prev, [category]: imgs }));
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
        setGroupAnalysis(prev => ({ ...prev, loading: false, done: true, error: 'AI 识别暂时不可用，可直接在下方通用槽上传服装' }));
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
      });
    } catch {
      if (seq !== seqRef.current) return;
      setGroupAnalysis(prev => ({ ...prev, loading: false, done: true, error: '识别失败，可点「重新识别」或直接在下方通用槽上传' }));
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
      ? { loading: false, done: false, primaryCategories: [], accessories: [] }
      : prev);
  };

  // ── 校验 + 成本 ──
  const lookbookOk = lookbookImages.length >= 1 && lookbookImages.length <= LOOKBOOK_MAX;
  const garmentsOk = groupGarmentImages.length >= 1 && groupGarmentImages.length <= MAX_TOTAL_GARMENTS;
  const canGenerate = lookbookOk && garmentsOk;
  const totalCostFen = Math.max(1, lookbookImages.length) * PRICE_PER_IMAGE_FEN;
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
      const projectId = await db.projects.add({
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending',
        name: projectName.trim() || `组图·换装 ${new Date().toLocaleString('zh-CN')}`,
        moduleType: 'scene',
        bodyType: DEFAULT_BODY_TYPE.id,
        skinTone: DEFAULT_SKIN_TONE.id,
        engine: selectedEngine,
        sceneOutputSize,
        sceneHasModel: true,
        sceneGroup: true,
        // 只序列化真正上传了图的品类，避免后端 prompt 点名换不存在的件
        sceneGroupCategories: JSON.stringify(
          Object.keys(groupGarments).filter(k => (groupGarments[k]?.length || 0) > 0),
        ),
        customWidth: sceneOutputSize === 'custom' ? sceneCustomW : undefined,
        customHeight: sceneOutputSize === 'custom' ? sceneCustomH : undefined,
      });

      await prepareProjectImageSlot(projectId as number);

      for (const img of groupGarmentImages) {
        await db.images.add({ projectId, type: 'product', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of lookbookImages) {
        await db.images.add({ projectId, type: 'scene_ref', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of accessoryImages) {
        await db.images.add({ projectId, type: 'accessory', data: img.base64, mimeType: img.mimeType });
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
        />

        {/* 引擎（组图默认 GPT 图像编辑以冻结场景） */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">生图引擎</h3>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">默认 GPT 图像编辑（能冻结原场景与姿势，较慢）；Gemini 更快但不保证冻结。</p>
          <EngineSelector selected={selectedEngine} onSelect={setSelectedEngine} variant="compact" />
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
            {groupAnalysis.done && detectedCount > 0 ? `识别到 ${detectedCount} 件 · ` : ''}
            已上传 {Object.keys(groupGarments).filter(k => (groupGarments[k]?.length || 0) > 0).length} 类主品 · 将生成 {lookbookImages.length} 张
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
                <span>生成 {lookbookImages.length} 张换装图（¥{(totalCostFen / 100).toFixed(2)}）</span>
              </>
            )}
          </button>
          {!canGenerate && currentUser && isBalanceSufficient && (
            <p className="text-[11px] text-[var(--color-text-muted)] text-center mt-2">
              {lookbookImages.length === 0 ? '先上传 lookbook' : groupGarmentImages.length === 0 ? '至少上传一件要换上的服装' : lookbookImages.length > LOOKBOOK_MAX ? `lookbook 最多 ${LOOKBOOK_MAX} 张` : `主品图合计最多 ${MAX_TOTAL_GARMENTS} 张`}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
