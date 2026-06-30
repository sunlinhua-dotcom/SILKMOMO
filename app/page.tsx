'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ImageUploader } from '@/components/ImageUploader';
import { BodyTypeSelector } from '@/components/BodyTypeSelector';
import { SkinToneSelector } from '@/components/SkinToneSelector';
import { ModelSelector } from '@/components/ModelSelector';
import { ModelQuickPicker } from '@/components/ModelQuickPicker';
import { EngineSelector, type ImageEngine } from '@/components/EngineSelector';
import { ProductShotModule } from '@/components/ProductShotModule';
import { SceneShotModule } from '@/components/SceneShotModule';
import { StylePackManager } from '@/components/StylePackManager';
import { BatchOutputMatrix } from '@/components/BatchOutputMatrix';
import { AIChatSidebar, AIChatBottomBar } from '@/components/AIChatBox';
import { TimeMachine } from '@/components/TimeMachine';
import { DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE, getDefaultShots } from '@/lib/models';
import { RecentProjectsStrip, RecentProjectsCompact } from '@/components/RecentProjectsStrip';
import { Wand2, ArrowRight, History, Camera, Trees, Sparkles, ChevronDown, Upload, Zap, Settings2, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { UserNav } from '@/components/UserNav';
import { useBrandMemory } from '@/hooks/useBrandMemory';
import { useProductAnalysis } from '@/hooks/useProductAnalysis';
import type { CompressedImage } from '@/lib/image-compressor';
import { saveSnapshot, generateThumb, type FlowSnapshot } from '@/lib/image-library';
import { db, migrateLegacyStylePackImages, prepareProjectImageSlot } from '@/lib/db';
import Link from 'next/link';

type ModuleType = 'product' | 'scene';

export default function HomePage() {
  // ── 渐进式步骤 ──
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── 品牌记忆 ──
  const brandPrefs = useBrandMemory();

  // ── AI 分析 ──
  const { analysis, analyze, reset: resetAnalysis } = useProductAnalysis();

  // ── 共用输入层 ──
  const [productImages, setProductImages] = useState<CompressedImage[]>([]);
  const [modelRefImages, setModelRefImages] = useState<CompressedImage[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedBodyType, setSelectedBodyType] = useState<'slim' | 'standard' | 'curvy'>(DEFAULT_BODY_TYPE.id);
  const [selectedSkinTone, setSelectedSkinTone] = useState<'light' | 'medium' | 'deep'>(DEFAULT_SKIN_TONE.id);
  const [selectedEngine, setSelectedEngine] = useState<ImageEngine>('gemini');

  // 配件
  const [accessoryImages, setAccessoryImages] = useState<CompressedImage[]>([]);

  // ── 模块切换 ──
  const [activeModule, setActiveModule] = useState<ModuleType>('product');

  // ── 产品图模块 ──
  const [skuType, setSkuType] = useState<'outfit' | 'top' | 'bottom'>('outfit');
  const [selectedShots, setSelectedShots] = useState<number[]>(getDefaultShots('outfit'));
  const [bgRefImages, setBgRefImages] = useState<CompressedImage[]>([]);
  const [productOutputSize, setProductOutputSize] = useState('pdp_main');
  const [productCustomW, setProductCustomW] = useState(1200);
  const [productCustomH, setProductCustomH] = useState(1500);

  // ── 场景图模块 ──
  const [sceneRefImages, setSceneRefImages] = useState<CompressedImage[]>([]);
  const [sceneHasModel, setSceneHasModel] = useState(true);
  const [sceneOutputSize, setSceneOutputSize] = useState('hero_desktop');
  const [sceneCustomW, setSceneCustomW] = useState(1080);
  const [sceneCustomH, setSceneCustomH] = useState(1350);

  const [isGenerating, setIsGenerating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');

  // ── 计费余额与充值弹窗 ──
  const [currentUser, setCurrentUser] = useState<{ balanceFen: number } | null>(null);
  const [showRechargeModal, setShowRechargeModal] = useState(false);

  // 风格包应用到的槽位（product → bgRefImages / scene → sceneRefImages），取消选中时按此清理
  const stylePackTargetRef = useRef<'product' | 'scene' | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.user) setCurrentUser(d.user); })
      .catch(() => {});
  }, [isGenerating]);

  // ── 品牌记忆自动回填 ──
  // 只回填一次，且跳过用户已手动改过的字段：
  // /api/brand 返回较慢时，无条件回填会把用户在加载完成前的手动选择静默改掉
  const touchedRef = useRef<{ bodyType?: boolean; skinTone?: boolean; module?: boolean; modelId?: boolean; engine?: boolean }>({});
  const brandAppliedRef = useRef(false);
  useEffect(() => {
    if (!brandPrefs.loaded || !brandPrefs.hasProfile || brandAppliedRef.current) return;
    brandAppliedRef.current = true;
    const touched = touchedRef.current;
    if (!touched.bodyType) setSelectedBodyType(brandPrefs.defaultBodyType);
    if (!touched.skinTone) setSelectedSkinTone(brandPrefs.defaultSkinTone);
    if (!touched.module) setActiveModule(brandPrefs.defaultModule);
    if (!touched.modelId && brandPrefs.defaultModelId) setSelectedModelId(brandPrefs.defaultModelId);
    if (!touched.engine) setSelectedEngine(brandPrefs.defaultEngine);
  }, [brandPrefs.loaded, brandPrefs.hasProfile, brandPrefs.defaultBodyType, brandPrefs.defaultSkinTone, brandPrefs.defaultModule, brandPrefs.defaultModelId, brandPrefs.defaultEngine]);

  // 用户手动选择参数（标记 touched，品牌回填不再覆盖）
  const selectBodyType = useCallback((v: 'slim' | 'standard' | 'curvy') => {
    touchedRef.current.bodyType = true;
    setSelectedBodyType(v);
  }, []);
  const selectSkinTone = useCallback((v: 'light' | 'medium' | 'deep') => {
    touchedRef.current.skinTone = true;
    setSelectedSkinTone(v);
  }, []);
  const selectModule = useCallback((v: ModuleType) => {
    touchedRef.current.module = true;
    setActiveModule(v);
  }, []);
  const selectModelId = useCallback((v: string) => {
    touchedRef.current.modelId = true;
    setSelectedModelId(v);
  }, []);
  const selectEngine = useCallback((v: ImageEngine) => {
    touchedRef.current.engine = true;
    setSelectedEngine(v);
  }, []);

  // ── 上传产品图后自动触发 AI 分析 ──
  // 跟踪"第一张图"指纹：替换首图要重新分析（旧逻辑 !analysis.done 会一直展示上一件衣服的描述）
  const lastAnalyzedRef = useRef<string | null>(null);
  useEffect(() => {
    if (productImages.length === 0) {
      lastAnalyzedRef.current = null;
      resetAnalysis();
      setStep(1);
      return;
    }
    const first = productImages[0];
    const fingerprint = `${first.base64.length}:${first.base64.slice(0, 64)}`;
    if (lastAnalyzedRef.current !== fingerprint) {
      lastAnalyzedRef.current = fingerprint;
      analyze(first.base64, first.mimeType);
    }
  }, [productImages, analyze, resetAnalysis]);

  // 上传完成后自动进入 Step 2（只在 0 → N 的瞬间推进，
  // 否则用户点步骤条"上传"回到 Step 1 会被立刻弹回 Step 2，按钮形同虚设）
  const prevProductCountRef = useRef(0);
  useEffect(() => {
    const prev = prevProductCountRef.current;
    prevProductCountRef.current = productImages.length;
    if (prev === 0 && productImages.length > 0 && step === 1) {
      // 场景图必须用 Step 3 的场景参考图上传框（且场景模式不显示折叠入口），
      // 所以场景模式上传后直接推进到 Step 3，避免停在 Step 2 无处可去。
      setStep(activeModule === 'scene' ? 3 : 2);
    }
  }, [productImages.length, step, activeModule]);

  const canGenerate = productImages.length >= 1 && productImages.length <= 3 && (
    activeModule === 'product' ? selectedShots.length > 0 : sceneRefImages.length > 0
  );

  // 场景图模式必须用 Step 3 里的「场景参考图」上传框,所以它的高级区是必需的、永远展开
  // (且场景模式不显示折叠入口)。产品图模式才用 showAdvanced 控制折叠。
  // 用这个派生值统一驱动「隐藏 Step2 重复控件」与「渲染 Step3」,避免某条进入场景模式的
  // 路径(如时光机回放只 setStep 不 setShowAdvanced)导致场景工作区整块消失。
  const advancedShown = showAdvanced || activeModule === 'scene';

  // ── 扣费计算与预警 ──
  // 注意：currentUser 未加载完前默认"余额不足"，避免在余额未知时让用户点击直接打到 /api/generate/stream
  const totalCostFen = activeModule === 'product' ? selectedShots.length * 65 : 65;
  const isBalanceSufficient = currentUser ? currentUser.balanceFen >= totalCostFen : false;
  const diffYuan = currentUser ? ((totalCostFen - currentUser.balanceFen) / 100).toFixed(2) : '0.00';

  const quickCostFen = getDefaultShots(skuType).length * 65;
  const isQuickBalanceSufficient = currentUser ? currentUser.balanceFen >= quickCostFen : false;
  const quickDiffYuan = currentUser ? ((quickCostFen - currentUser.balanceFen) / 100).toFixed(2) : '0.00';

  const handleGenerate = async (shotsOverride?: number[]) => {
    if (!canGenerate && !shotsOverride) return;
    // 快速生成路径传 shotsOverride，避免 setState 异步导致 selectedShots 仍是旧值
    const effectiveShots = shotsOverride ?? selectedShots;
    if (activeModule === 'product' && effectiveShots.length === 0) return;
    setIsGenerating(true);

    try {
      await migrateLegacyStylePackImages();
      const projectId = await db.projects.add({
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending',
        name: projectName || `${activeModule === 'product' ? '产品图' : '场景图'} ${new Date().toLocaleString('zh-CN')}`,
        moduleType: activeModule,
        modelId: selectedModelId || undefined,
        bodyType: selectedBodyType,
        skinTone: selectedSkinTone,
        engine: selectedEngine,
        skuType: activeModule === 'product' ? skuType : undefined,
        selectedShots: activeModule === 'product' ? JSON.stringify(effectiveShots) : undefined,
        outputSize: activeModule === 'product' ? productOutputSize : undefined,
        // 自定义尺寸宽高：产品/场景模块各自的输入（场景模块此前漏存，导致自定义尺寸永远不生效）
        customWidth: activeModule === 'product'
          ? (productOutputSize === 'custom' ? productCustomW : undefined)
          : (sceneOutputSize === 'custom' ? sceneCustomW : undefined),
        customHeight: activeModule === 'product'
          ? (productOutputSize === 'custom' ? productCustomH : undefined)
          : (sceneOutputSize === 'custom' ? sceneCustomH : undefined),
        sceneOutputSize: activeModule === 'scene' ? sceneOutputSize : undefined,
        sceneHasModel: activeModule === 'scene' ? sceneHasModel : undefined,
        customPrompt: customPrompt.trim() || undefined,
      });

      await prepareProjectImageSlot(projectId as number);

      for (const img of productImages) {
        await db.images.add({ projectId, type: 'product', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of modelRefImages) {
        await db.images.add({ projectId, type: 'model_ref', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of bgRefImages) {
        await db.images.add({ projectId, type: 'bg_ref', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of sceneRefImages) {
        await db.images.add({ projectId, type: 'scene_ref', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of accessoryImages) {
        await db.images.add({ projectId, type: 'accessory', data: img.base64, mimeType: img.mimeType });
      }

      // ── 保存时光机快照 ──
      try {
        const thumbs = await Promise.all(
          productImages.slice(0, 3).map(img => generateThumb(img.dataUrl))
        );
        const bodyLabel = { slim: '纤细', standard: '标准', curvy: '丰满' }[selectedBodyType];
        const moduleLabel = activeModule === 'product' ? '产品图' : '场景图';
        // 用 effectiveShots（快速生成会传 shotsOverride，此时 selectedShots state 尚未刷新）
        const countLabel = activeModule === 'product' ? `${effectiveShots.length}张` : '1张';

        saveSnapshot({
          label: `${moduleLabel} · ${bodyLabel} · ${countLabel}`,
          module: activeModule,
          bodyType: selectedBodyType,
          skinTone: selectedSkinTone,
          modelId: selectedModelId || undefined,
          engine: selectedEngine,
          skuType: activeModule === 'product' ? skuType : undefined,
          sceneHasModel: activeModule === 'scene' ? sceneHasModel : undefined,
          outputSize: activeModule === 'product' ? productOutputSize : sceneOutputSize,
          selectedShots: activeModule === 'product' ? effectiveShots : undefined,
          customPrompt: customPrompt || undefined,
          productImageThumbs: thumbs.filter(Boolean),
          sceneRefThumbs: sceneRefImages.length > 0
            ? await Promise.all(sceneRefImages.slice(0, 2).map(img => generateThumb(img.dataUrl)))
            : undefined,
          taskId: String(projectId),
        });
      } catch (e) {
        console.warn('保存时光机快照失败:', e);
      }

      window.location.href = `/task/${projectId}`;
    } catch (error) {
      console.error('创建任务失败:', error);
      alert('创建任务失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  // 快速生成：使用默认镜次，不展开 Step 3
  // 直接把默认镜次作为参数传给 handleGenerate，避免 setSelectedShots 的异步 race
  const handleQuickGenerate = async () => {
    if (productImages.length < 1) return;
    const defaultShots = getDefaultShots(skuType);
    setSelectedShots(defaultShots);
    await handleGenerate(defaultShots);
  };

  // ── 时光机回放 ──
  const handleReplay = useCallback((snapshot: FlowSnapshot) => {
    selectModule(snapshot.module);
    selectBodyType(snapshot.bodyType as 'slim' | 'standard' | 'curvy');
    selectSkinTone(snapshot.skinTone as 'light' | 'medium' | 'deep');
    if (snapshot.modelId !== undefined) {
      selectModelId(snapshot.modelId);
    }
    // 引擎 / SKU / 尺寸 / 场景模式：旧快照没有这些字段时跳过（保持当前值）
    if (snapshot.engine) {
      selectEngine(snapshot.engine);
    }
    if (snapshot.skuType) {
      setSkuType(snapshot.skuType);
    }
    if (snapshot.sceneHasModel !== undefined) {
      setSceneHasModel(snapshot.sceneHasModel);
    }
    if (snapshot.outputSize) {
      if (snapshot.module === 'product') setProductOutputSize(snapshot.outputSize);
      else setSceneOutputSize(snapshot.outputSize);
    }
    if (snapshot.selectedShots) {
      setSelectedShots(snapshot.selectedShots);
    }
    if (snapshot.customPrompt) {
      setCustomPrompt(snapshot.customPrompt);
    }
    // 跳到对应步骤。产品图快照带自定义镜次时(saveSnapshot 总会写镜次),要展开高级区——
    // 否则恢复的镜次既看不见、「快速生成」又只用默认镜次,"按相同参数重做"会落空。
    // 场景图本就靠 advancedShown 恒展开。
    const replayWantsAdvanced =
      snapshot.module === 'scene' ||
      (snapshot.module === 'product' && !!snapshot.selectedShots && snapshot.selectedShots.length > 0);
    if (replayWantsAdvanced) setShowAdvanced(true);
    if (productImages.length > 0) {
      setStep(replayWantsAdvanced ? 3 : 2);
    }
    // 滚到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [productImages.length, selectModule, selectBodyType, selectSkinTone, selectModelId, selectEngine]);

  return (
    <div className="min-h-screen bg-[var(--color-background)] pb-36 lg:pb-12">
      {/* ═══ 桌面端 AI 侧边栏（hidden on mobile） ═══ */}
      <AIChatSidebar
        context={`体型:${selectedBodyType} 肤色:${selectedSkinTone} 模式:${activeModule === 'product' ? '产品图' : '场景图'} 已上传:${productImages.length}张`}
        onActions={(actions) => {
          if (actions.bodyType) selectBodyType(actions.bodyType);
          if (actions.skinTone) selectSkinTone(actions.skinTone);
          if (actions.module === 'scene') { selectModule('scene'); setShowAdvanced(true); if (productImages.length > 0) setStep(3); }
          if (actions.module === 'product') selectModule('product');
          if (actions.prompt) setCustomPrompt(prev => prev ? `${prev}, ${actions.prompt!}` : actions.prompt!);
          if (step < 2 && productImages.length > 0) setStep(2);
        }}
        onTriggerGenerate={() => { if (productImages.length > 0) { if (isQuickBalanceSufficient) handleQuickGenerate(); else setShowRechargeModal(true); } }}
      />

      {/* ═══ 移动端 AI 底栏（hidden on desktop） ═══ */}
      <AIChatBottomBar
        context={`体型:${selectedBodyType} 肤色:${selectedSkinTone} 模式:${activeModule === 'product' ? '产品图' : '场景图'} 已上传:${productImages.length}张`}
        onActions={(actions) => {
          if (actions.bodyType) selectBodyType(actions.bodyType);
          if (actions.skinTone) selectSkinTone(actions.skinTone);
          if (actions.module === 'scene') { selectModule('scene'); setShowAdvanced(true); if (productImages.length > 0) setStep(3); }
          if (actions.module === 'product') selectModule('product');
          if (actions.prompt) setCustomPrompt(prev => prev ? `${prev}, ${actions.prompt!}` : actions.prompt!);
          if (step < 2 && productImages.length > 0) setStep(2);
        }}
        onTriggerGenerate={() => { if (productImages.length > 0) { if (isQuickBalanceSufficient) handleQuickGenerate(); else setShowRechargeModal(true); } }}
      />

      {/* 桌面端：主内容向右偏移以避让左侧 AI 边栏（72 * 4 = 288px）。
          header 必须在这个容器内 —— 放外面时毛玻璃导航会横跨全宽,
          压住边栏顶部的 AI Stylist 区块,LOGO 也会叠进边栏(与任务页保持同构) */}
      <div className="lg:pl-72 transition-all duration-500">

      {/* 顶部导航 */}
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
              <Link
                href="/tasks"
                className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] tracking-widest uppercase text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors duration-300"
              >
                <History className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
                <span className="hidden sm:inline">Archives</span>
              </Link>
              <UserNav />
            </div>
          </div>
        </div>
      </header>

      {/* 极简进度指示器 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 pt-5 sm:pt-10 mb-2 sm:mb-4">
        <div className="flex items-center justify-center gap-2 sm:gap-6">
          {[
            { num: 1, label: '上传', icon: Upload },
            { num: 2, label: '参数', icon: Settings2 },
            { num: 3, label: '生成', icon: Zap },
          ].map((s, i) => (
            <div key={s.num} className="flex items-center gap-2 sm:gap-6">
              {i > 0 && (
                <div className={`w-6 sm:w-20 h-[1px] ${step >= s.num ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'} transition-colors duration-500`} />
              )}
              <button
                onClick={() => {
                  if (s.num === 1) setStep(1);
                  else if (s.num === 2 && productImages.length > 0) setStep(2);
                  // 点「3 生成」要同时展开高级区,否则 step=3 但 advancedShown=false 时
                  // Step3 不渲染——指示器高亮"当前步"却没有对应内容(与场景按钮/折叠开关一致)
                  else if (s.num === 3 && productImages.length > 0) { setShowAdvanced(true); setStep(3); }
                }}
                className={`
                  flex items-center gap-1.5 sm:gap-2 transition-all duration-500 tracking-widest uppercase
                  ${step === s.num
                    ? 'text-[var(--color-primary)] opacity-100'
                    : step > s.num
                      ? 'text-[var(--color-accent)] opacity-80'
                      : 'text-[var(--color-text-muted)] opacity-50'
                  }
                `}
              >
                <s.icon className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${step === s.num ? 'text-[var(--color-accent)]' : ''}`} strokeWidth={1.5} aria-hidden="true" />
                <span className="text-[10px] sm:text-xs">{s.label}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

        {/* ═══ AI 搜索栏（桌面已移至侧边栏，此区域删除） ═══ */}

      {/* ═══ 移动端：时光机 + 最近项目胶囊条（桌面端隐藏） ═══ */}
      <div className="lg:hidden max-w-[85rem] mx-auto px-4 sm:px-6 py-2">
        <TimeMachine onReplay={handleReplay} />
        <RecentProjectsStrip />
      </div>

      {/* 主内容区 */}
      <main className="max-w-[85rem] mx-auto px-4 sm:px-6 lg:px-12 py-4 sm:py-8">
        <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-16">

          {/* 左侧主操作区 — 8 列 */}
          <div className="lg:col-span-8 space-y-6 sm:space-y-10 lg:space-y-14">

            {/* ═══ STEP 1：上传产品图 ═══ */}
            <div className="animate-fade-in-up">
              <div className="flex items-center justify-between mb-4 sm:mb-8">
                <div className="flex items-center gap-2 sm:gap-4">
                  <span className="font-serif text-xl sm:text-3xl text-[var(--color-primary)] tracking-tight">01.</span>
                  <span className="text-xs sm:text-sm font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">产品参考图</span>
                </div>
              </div>

              <ImageUploader
                title="产品参考图"
                description="1-3 张，白底图/模特图/场景图均可（必填）。建议避免对镜自拍/带水印的网图，否则可能被 AI 拒绝生成。"
                required
                maxFiles={3}
                images={productImages}
                onImagesChange={setProductImages}
                variant="gold"
              />

              {/* AI 分析结果卡片 */}
              {analysis.loading && (
                <div className="mt-3 p-3 rounded-xl bg-[rgba(201,168,108,0.06)] border border-[var(--color-accent)]/20 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-accent)]">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" aria-hidden="true" />
                    <span>AI 正在分析产品特征…</span>
                  </div>
                </div>
              )}
              {analysis.done && analysis.description && (
                <div className="mt-3 p-3 rounded-xl bg-[rgba(201,168,108,0.06)] border border-[var(--color-accent)]/20 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-accent)] mb-1.5">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>AI 识别结果</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                    {analysis.description}
                  </p>
                  {analysis.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {analysis.keywords.slice(0, 6).map((kw, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-background)] text-[var(--color-text-muted)]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ═══ STEP 2：确认参数 ═══ */}
            {step >= 2 && (
              <div className="animate-fade-in-up space-y-5 sm:space-y-8 pt-4 sm:pt-6 border-t border-[var(--color-border-light)]/50">
                <div className="flex items-center justify-between mb-4 sm:mb-8">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <span className="font-serif text-xl sm:text-3xl text-[var(--color-primary)] tracking-tight">02.</span>
                    <span className="text-xs sm:text-sm font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">选择模式</span>
                    {brandPrefs.hasProfile && (
                      <span className="text-[10px] bg-[rgba(212,175,55,0.1)] text-[var(--color-accent)] px-1.5 py-0.5 rounded-full">品牌记忆</span>
                    )}
                  </div>
                </div>

                {/* 模块切换 */}
                <div className="grid grid-cols-2 gap-3 sm:gap-6">
                  <button
                    onClick={() => selectModule('product')}
                    className={`
                      relative flex flex-col items-start gap-2 sm:gap-4 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] transition-[background-color,border-color,box-shadow] duration-500 overflow-hidden
                      ${activeModule === 'product'
                        ? 'bg-[#3D2E20] text-white shadow-xl sm:shadow-2xl'
                        : 'bg-[#FAFAFA] border border-transparent hover:border-[var(--color-border)] text-[var(--color-text)]'
                      }
                    `}
                  >
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center ${
                      activeModule === 'product' ? 'bg-white/10 text-white' : 'bg-white text-[var(--color-primary)] shadow-sm'
                    }`}>
                      <Camera className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                    </div>
                    <div className="text-left relative z-10">
                      <div className="font-serif text-base sm:text-xl tracking-wide">产品图</div>
                      <div className={`text-[10px] sm:text-xs mt-0.5 ${activeModule === 'product' ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>电商主图</div>
                    </div>
                    {activeModule === 'product' && <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-[var(--color-accent)]/20 rounded-full blur-3xl pointer-events-none"></div>}
                  </button>

                  <button
                    onClick={() => { selectModule('scene'); setShowAdvanced(true); setStep(3); }}
                    className={`
                      relative flex flex-col items-start gap-2 sm:gap-4 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] transition-[background-color,border-color,box-shadow] duration-500 overflow-hidden
                      ${activeModule === 'scene'
                        ? 'bg-[#3D2E20] text-white shadow-xl sm:shadow-2xl'
                        : 'bg-[#FAFAFA] border border-transparent hover:border-[var(--color-border)] text-[var(--color-text)]'
                      }
                    `}
                  >
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center ${
                      activeModule === 'scene' ? 'bg-white/10 text-white' : 'bg-white text-[var(--color-primary)] shadow-sm'
                    }`}>
                      <Trees className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                    </div>
                    <div className="text-left relative z-10">
                      <div className="font-serif text-base sm:text-xl tracking-wide">场景图</div>
                      <div className={`text-[10px] sm:text-xs mt-0.5 ${activeModule === 'scene' ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>生活方式</div>
                    </div>
                    {activeModule === 'scene' && <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-[var(--color-accent)]/20 rounded-full blur-3xl pointer-events-none"></div>}
                  </button>
                </div>

                {/* 模特快选（一键切换人种 / 性别）— 展开高级后用 Step 3 的完整 ModelSelector，避免重复 */}
                {!advancedShown && (
                  <ModelQuickPicker
                    selectedModel={selectedModelId}
                    onSelect={selectModelId}
                  />
                )}

                {/* 体型 + 肤色（并排紧凑） */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <BodyTypeSelector
                    selectedBodyType={selectedBodyType}
                    onSelect={selectBodyType}
                  />
                  <SkinToneSelector
                    selectedSkinTone={selectedSkinTone}
                    onSelect={selectSkinTone}
                  />
                </div>

                {/* 生图引擎快选 — 展开高级后用 Step 3 的完整 EngineSelector，避免重复 */}
                {!advancedShown && (
                  <EngineSelector
                    selected={selectedEngine}
                    onSelect={selectEngine}
                    variant="compact"
                  />
                )}

                {/* 快速生成按钮 — 产品图模式；展开高级后改用 Step 3 底部的「生成」按钮（按自定义镜次） */}
                {activeModule === 'product' && !showAdvanced && (
                  <button
                    onClick={isQuickBalanceSufficient ? handleQuickGenerate : () => setShowRechargeModal(true)}
                    disabled={isGenerating || productImages.length < 1}
                    className={`w-full transition-all duration-300 ${
                      isQuickBalanceSufficient
                        ? 'btn-primary'
                        : 'bg-gradient-to-r from-gray-400 to-[var(--color-accent)]/80 text-white border-transparent cursor-pointer rounded-xl py-4 flex items-center justify-center gap-2 hover:opacity-95'
                    }`}
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>生成中…</span>
                      </>
                    ) : (
                      <>
                        {isQuickBalanceSufficient ? (
                          <>
                            <Zap className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                            <span>快速生成 {getDefaultShots(skuType).length} 张产品图</span>
                            <ArrowRight className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                          </>
                        ) : (
                          <>
                            <Zap className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                            <span>余额不足（差 ¥{quickDiffYuan}）</span>
                          </>
                        )}
                      </>
                    )}
                  </button>
                )}

                {/* 展开 / 收起 高级选项（可来回切换）。
                    仅产品图模式可折叠：场景图必须用 Step 3 里的「场景参考图」上传，强制展开、不显示折叠入口。 */}
                {activeModule === 'product' && (
                  <button
                    onClick={() => {
                      if (showAdvanced) { setShowAdvanced(false); setStep(2); }
                      else { setShowAdvanced(true); setStep(3); }
                    }}
                    aria-expanded={showAdvanced}
                    className="flex items-center justify-center gap-2 w-full py-2.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                  >
                    <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{showAdvanced ? '收起高级选项' : '自定义镜次、模特参考图、配件和更多选项…'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {/* ═══ STEP 3：高级自定义 ═══
                 场景图：上传后(step≥2)始终展开(场景参考图等必需控件都在这里);
                 产品图：仅在用户点开折叠(showAdvanced)时展开。统一用 advancedShown 驱动。 */}
            {step >= 2 && advancedShown && (
              <div className="animate-fade-in-up space-y-5 sm:space-y-10 pt-4 sm:pt-10 border-t border-[var(--color-border-light)]/50">
                <div className="flex items-center justify-between mb-4 sm:mb-8">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <span className="font-serif text-xl sm:text-3xl text-[var(--color-primary)] tracking-tight">03.</span>
                    <span className="text-xs sm:text-sm font-medium tracking-widest uppercase text-[var(--color-text-secondary)]">高级设置</span>
                  </div>
                </div>

                {/* 项目名称: 幽灵输入框 (Ghost Border style) */}
                <div className="relative group">
                  <input
                    type="text"
                    id="projectName"
                    name="projectName"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Project Name (Optional)…"
                    aria-label="项目名称"
                    autoComplete="off"
                    className="w-full text-xl font-serif text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/50 border-0 border-b border-[var(--color-border-light)] focus:border-[var(--color-accent)] focus:ring-0 px-2 py-4 bg-transparent transition-colors"
                  />
                </div>

                {/* 意境提示词与快捷包 */}
                <div className="space-y-3 pt-2">
                  <label htmlFor="customPrompt" className="text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">
                    意境提示词 (Custom Prompt)
                  </label>

                  {/* 快捷意境词预设 (Editorial Presets) */}
                  <div className="flex flex-wrap gap-2 py-1">
                    {[
                      { label: '南法慵懒阳光 ☀️', prompt: 'Warm sunlit French villa, cinematic natural backlight' },
                      { label: '侘寂极简角落 🏺', prompt: 'Minimalist wabi-sabi room corner, plaster texture wall, shadow play' },
                      { label: '奢华缎面高光 ✨', prompt: 'Luminous editorial sheen, silk luster emphasis, studio shadow' },
                      { label: '晨曦柔和侧光 🌅', prompt: 'Soft morning glow, lateral natural light, dreamlike haze' }
                    ].map((preset) => {
                      const isAdded = customPrompt.includes(preset.prompt);
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            if (isAdded) {
                              setCustomPrompt(prev => prev.replace(preset.prompt, '').replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '').trim());
                            } else {
                              setCustomPrompt(prev => prev ? `${prev}, ${preset.prompt}` : preset.prompt);
                            }
                          }}
                          className={`text-xs px-3.5 py-1.5 rounded-full border transition-all duration-300 cursor-pointer ${
                            isAdded
                              ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] shadow-sm'
                              : 'bg-[var(--color-background)] text-[var(--color-text-secondary)] border-[var(--color-border-light)] hover:border-[var(--color-accent)] hover:bg-white'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <textarea
                    id="customPrompt"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="例如：Minimalist background, natural studio lighting, highly detailed texture…"
                    rows={3}
                    className="w-full text-sm px-4 py-3 border border-[var(--color-border-light)] rounded-xl focus:outline-none focus:border-[var(--color-accent)] focus:ring-0 resize-none text-[var(--color-text)] bg-transparent placeholder:text-[var(--color-text-muted)]/50"
                  />
                </div>

                {/* 生图引擎（卡片模式，详细对比两个 backend） */}
                <EngineSelector
                  selected={selectedEngine}
                  onSelect={selectEngine}
                  variant="full"
                />

                {/* 模特预设（5 张完整卡片，含肤色/发型细节） */}
                <ModelSelector
                  selectedModel={selectedModelId}
                  onSelect={selectModelId}
                />

                {/* 模特参考图 */}
                <ImageUploader
                  title="模特参考图"
                  description="可选，1-3 张。系统模仿妆发、神情、年龄感。"
                  maxFiles={3}
                  images={modelRefImages}
                  onImagesChange={setModelRefImages}
                  variant="gray"
                />

                {/* 模块内容（镜次/场景） */}
                {activeModule === 'product' && (
                  <ProductShotModule
                    skuType={skuType}
                    onSkuTypeChange={setSkuType}
                    selectedShots={selectedShots}
                    onShotsChange={setSelectedShots}
                    bgRefImages={bgRefImages}
                    onBgRefImagesChange={setBgRefImages}
                    outputSize={productOutputSize}
                    onOutputSizeChange={setProductOutputSize}
                    customWidth={productCustomW}
                    customHeight={productCustomH}
                    onCustomSizeChange={(w, h) => { setProductCustomW(w); setProductCustomH(h); }}
                  />
                )}

                {activeModule === 'scene' && (
                  <SceneShotModule
                    sceneRefImages={sceneRefImages}
                    onSceneRefImagesChange={setSceneRefImages}
                    hasModel={sceneHasModel}
                    onHasModelChange={setSceneHasModel}
                    outputSize={sceneOutputSize}
                    onOutputSizeChange={setSceneOutputSize}
                    customWidth={sceneCustomW}
                    customHeight={sceneCustomH}
                    onCustomSizeChange={(w, h) => { setSceneCustomW(w); setSceneCustomH(h); }}
                  />
                )}

                {/* 配件 (无边框极简下拉) */}
                <div className="group">
                  <details className="overflow-hidden">
                    <summary className="flex items-center justify-between py-4 cursor-pointer list-none border-b border-[var(--color-border-light)] group-open:border-[var(--color-accent)] transition-colors">
                      <div className="flex items-center gap-4">
                        <span className="font-serif text-lg text-[var(--color-text)] tracking-wide">Accessories</span>
                        <span className="text-[10px] tracking-widest uppercase text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-1 rounded-sm">Optional</span>
                        {accessoryImages.length > 0 && (
                          <span className="text-[10px] font-semibold text-[var(--color-accent)] uppercase tracking-widest">{accessoryImages.length} Saved</span>
                        )}
                      </div>
                      <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)] group-open:rotate-180 transition-transform duration-300" strokeWidth={1} aria-hidden="true" />
                    </summary>
                    <div className="pt-6 pb-2 animate-fade-in">
                      <ImageUploader
                        title="Accessories"
                        description="Bags, Jewelry, Eyewear."
                        maxFiles={5}
                        images={accessoryImages}
                        onImagesChange={setAccessoryImages}
                        variant="dashed"
                      />
                    </div>
                  </details>
                </div>

                {/* 风格包 */}
                <StylePackManager
                  variant="compact"
                  onApply={(imgs) => {
                    // 取消选中（imgs 为空）要清"当初应用到"的槽位：
                    // 在产品模式应用、切到场景模式再取消，清错槽位会让包图残留并继续参与生成
                    if (imgs.length === 0) {
                      if (stylePackTargetRef.current === 'scene') setSceneRefImages([]);
                      else if (stylePackTargetRef.current === 'product') setBgRefImages([]);
                      stylePackTargetRef.current = null;
                      return;
                    }
                    stylePackTargetRef.current = activeModule === 'scene' ? 'scene' : 'product';
                    if (activeModule === 'scene') setSceneRefImages(imgs);
                    else setBgRefImages(imgs);
                  }}
                />

                {/* 批量矩阵 */}
                <BatchOutputMatrix
                  moduleType={activeModule}
                  disabled={!canGenerate}
                  onStartBatch={async (config) => {
                    if (!canGenerate) return;

                    const modelVar = config.variables.find(v => v.type === 'model');
                    const bodyVar = config.variables.find(v => v.type === 'bodyType');
                    const skinVar = config.variables.find(v => v.type === 'skinTone');
                    const sizeVar = config.variables.find(v => v.type === 'outputSize');

                    const models = modelVar?.values.length ? modelVar.values : [selectedModelId || ''];
                    const bodies = bodyVar?.values.length ? bodyVar.values : [selectedBodyType];
                    const skins = skinVar?.values.length ? skinVar.values : [selectedSkinTone];
                    const sizes = sizeVar?.values.length ? sizeVar.values : [activeModule === 'product' ? productOutputSize : sceneOutputSize];

                    const MAX_BATCH = 20;
                    const totalProjects = models.length * bodies.length * skins.length * sizes.length;
                    const imagesPerProject = activeModule === 'product' ? selectedShots.length : 1;
                    const totalImages = totalProjects * imagesPerProject;
                    const totalCostFen = totalImages * 65;
                    const totalCostYuan = (totalCostFen / 100).toFixed(2);

                    // 上限保护
                    if (totalProjects > MAX_BATCH) {
                      alert(`批量组合数 ${totalProjects} 超过上限 ${MAX_BATCH}。\n请减少某个维度的选项（每行勾选数 × 维度数 ≤ ${MAX_BATCH}）。`);
                      return;
                    }
                    if (totalProjects === 0) {
                      alert('请至少在一个维度上勾选 1 个值。');
                      return;
                    }

                    // 余额检查
                    if (currentUser && currentUser.balanceFen < totalCostFen) {
                      const diff = ((totalCostFen - currentUser.balanceFen) / 100).toFixed(2);
                      alert(`余额不足。批量总成本 ¥${totalCostYuan}，当前余额 ¥${(currentUser.balanceFen / 100).toFixed(2)}，还差 ¥${diff}。`);
                      setShowRechargeModal(true);
                      return;
                    }

                    // 二次确认（避免一键耗尽余额）
                    const confirmMsg = `即将创建 ${totalProjects} 个生成任务，共 ${totalImages} 张图。\n` +
                      `预估总成本：¥${totalCostYuan}\n\n` +
                      `任务会进入"待生成"状态，需要在任务列表逐个手动启动。\n\n` +
                      `确认继续吗？`;
                    if (!confirm(confirmMsg)) return;

                    setIsGenerating(true);
                    try {
                      await migrateLegacyStylePackImages();
                      const combinations: Array<{ modelId: string; bodyType: string; skinTone: string; outputSize: string }> = [];
                      for (const m of models) {
                        for (const b of bodies) {
                          for (const s of skins) {
                            for (const sz of sizes) {
                              combinations.push({ modelId: m, bodyType: b, skinTone: s, outputSize: sz });
                            }
                          }
                        }
                      }

                      const batchTag = `批量 ${new Date().toLocaleString('zh-CN')}`;

                      for (let i = 0; i < combinations.length; i++) {
                        const combo = combinations[i];
                        const comboLabel = [
                          combo.modelId ? `${combo.modelId}` : '',
                          combo.bodyType,
                          combo.skinTone,
                        ].filter(Boolean).join('·');

                        const projectId = await db.projects.add({
                          createdAt: new Date(),
                          updatedAt: new Date(),
                          status: 'pending',
                          name: `${batchTag} #${i + 1}/${combinations.length} (${comboLabel})`,
                          moduleType: activeModule,
                          modelId: combo.modelId || undefined,
                          bodyType: combo.bodyType as 'slim' | 'standard' | 'curvy',
                          skinTone: combo.skinTone as 'light' | 'medium' | 'deep',
                          engine: selectedEngine,
                          skuType: activeModule === 'product' ? skuType : undefined,
                          selectedShots: activeModule === 'product' ? JSON.stringify(selectedShots) : undefined,
                          outputSize: activeModule === 'product' ? combo.outputSize : undefined,
                          customWidth: combo.outputSize === 'custom'
                            ? (activeModule === 'product' ? productCustomW : sceneCustomW)
                            : undefined,
                          customHeight: combo.outputSize === 'custom'
                            ? (activeModule === 'product' ? productCustomH : sceneCustomH)
                            : undefined,
                          sceneOutputSize: activeModule === 'scene' ? combo.outputSize : undefined,
                          sceneHasModel: activeModule === 'scene' ? sceneHasModel : undefined,
                          customPrompt: customPrompt.trim() || undefined,
                        });

                        await prepareProjectImageSlot(projectId as number);

                        // 图片每个项目都复制一份（IndexedDB 没有跨表引用机制，
                        // 但因为 MAX_BATCH=20 + 通常 < 5 张输入图，总占用 ≤ ~150MB，可控）
                        for (const img of productImages) {
                          await db.images.add({ projectId, type: 'product', data: img.base64, mimeType: img.mimeType });
                        }
                        for (const img of modelRefImages) {
                          await db.images.add({ projectId, type: 'model_ref', data: img.base64, mimeType: img.mimeType });
                        }
                        for (const img of bgRefImages) {
                          await db.images.add({ projectId, type: 'bg_ref', data: img.base64, mimeType: img.mimeType });
                        }
                        for (const img of sceneRefImages) {
                          await db.images.add({ projectId, type: 'scene_ref', data: img.base64, mimeType: img.mimeType });
                        }
                        for (const img of accessoryImages) {
                          await db.images.add({ projectId, type: 'accessory', data: img.base64, mimeType: img.mimeType });
                        }
                      }

                      window.location.href = '/tasks';
                    } catch (error) {
                      console.error('批量创建失败:', error);
                      alert('批量创建失败，请重试');
                    } finally {
                      setIsGenerating(false);
                    }
                  }}
                />

                {/* Step 3 的自定义生成按钮 */}
                <button
                  onClick={isBalanceSufficient ? () => handleGenerate() : () => setShowRechargeModal(true)}
                  /* 余额不足时不要 disable —— 否则用户连充值入口都点不动。
                     仅在「余额够但参数不全」时禁用（此时无处可去）。 */
                  disabled={isGenerating || !currentUser || (isBalanceSufficient && !canGenerate)}
                  className={`w-full transition-all duration-300 ${
                    isBalanceSufficient
                      ? 'btn-primary'
                      : 'bg-gradient-to-r from-gray-400 to-[var(--color-accent)]/80 text-white border-transparent cursor-pointer rounded-xl py-4 flex items-center justify-center gap-2 hover:opacity-95'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>生成中…</span>
                    </>
                  ) : (
                    <>
                      {isBalanceSufficient ? (
                        <>
                          <Wand2 className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                          <span className="relative z-10">
                            {!canGenerate
                              ? activeModule === 'scene' && sceneRefImages.length === 0
                                ? '请上传场景参考图'
                                : selectedShots.length === 0
                                  ? '请至少选择 1 个镜次'
                                  : '开始生成'
                              : activeModule === 'product'
                                ? `生成 ${selectedShots.length} 张产品图`
                                : '生成场景图'
                            }
                          </span>
                          {canGenerate && <ArrowRight className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />}
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                          <span>余额不足（差 ¥{diffYuan}）</span>
                        </>
                      )}
                    </>
                  )}
                </button>
              </div>
            )}

          </div>

          {/* 右侧栏 — 4 列（仅桌面端显示，移动端已前置） */}
          <div className="hidden lg:block lg:col-span-4">
            <div className="lg:sticky lg:top-28 space-y-6">
              {/* 时光机 — 快速重做 */}
              <TimeMachine onReplay={handleReplay} />
              {/* 最近任务 — 紧凑版 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-serif text-sm tracking-wide text-[var(--color-text)]">最近项目</h3>
                  <Link href="/tasks" className="text-[10px] tracking-widest uppercase text-[var(--color-accent)] hover:text-[var(--color-accent-dark)] transition-colors">
                    全部
                  </Link>
                </div>
                <RecentProjectsCompact />
              </div>

              {/* AI Stylist 卡片 — 已移至左侧边栏 */}
            </div>
          </div>

        </div>
      </main>

      {/* 移动端固定底部快速生成按钮 */}
      {step >= 2 && activeModule === 'product' && !showAdvanced && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-[var(--color-border-light)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            onClick={isQuickBalanceSufficient ? handleQuickGenerate : () => setShowRechargeModal(true)}
            disabled={isGenerating || productImages.length < 1}
            className={`w-full transition-all duration-300 ${
              isQuickBalanceSufficient
                ? 'btn-primary'
                : 'bg-gradient-to-r from-gray-400 to-[var(--color-accent)]/80 text-white border-transparent cursor-pointer rounded-xl py-4 flex items-center justify-center gap-2 hover:opacity-95'
            }`}
          >
            {isGenerating ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>生成中…</span>
              </>
            ) : (
              <>
                {isQuickBalanceSufficient ? (
                  <>
                    <Zap className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                    <span>快速生成 {getDefaultShots(skuType).length} 张</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
                    <span>余额不足（差 ¥{quickDiffYuan}）</span>
                  </>
                )}
              </>
            )}
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 sm:mt-24 lg:mt-32 mb-8 sm:mb-16">
        <div className="max-w-[85rem] mx-auto px-4 sm:px-6 lg:px-12">
          <div className="border-t border-[var(--color-border-light)] pt-6 sm:pt-12 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
            <p className="font-serif text-xs sm:text-sm tracking-widest text-[var(--color-text-muted)]">
              SILXINE
            </p>
            <p className="text-[9px] sm:text-[10px] tracking-widest uppercase text-[var(--color-text-muted)]">
              © 2026 · Haute Couture, AI-Powered
            </p>
          </div>
        </div>
      </footer>
      </div>

      {/* 充值联系 Modal */}
      {showRechargeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowRechargeModal(false)}>
          <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-[var(--color-border-light)] animate-fade-in" onClick={e => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-light)]">
              <h3 className="font-serif text-lg text-[var(--color-primary)] tracking-wide">账户充值申请</h3>
              <button
                onClick={() => setShowRechargeModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-background)] transition-colors cursor-pointer"
                aria-label="关闭充值窗口"
              >
                <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
              </button>
            </div>

            {/* 内容 */}
            <div className="p-5 space-y-6">
              <div className="p-4 bg-[var(--color-background)] rounded-xl space-y-2.5">
                <p className="text-xs text-[var(--color-text-secondary)] font-medium">可用余额</p>
                <p className="text-2xl font-bold text-[var(--color-accent)] tabular-nums">
                  ¥{currentUser ? (currentUser.balanceFen / 100).toFixed(2) : '0.00'}
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  生图单价：¥0.65/次 (基于高定算力及 Token 真实扣除)
                </p>
              </div>

              {/* 套餐介绍 */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">官方特惠套餐</h4>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { yuan: 150, times: 230 },
                    { yuan: 300, times: 460 },
                    { yuan: 750, times: 1153 },
                    { yuan: 1500, times: 2307 }
                  ].map(pkg => (
                    <div key={pkg.yuan} className="p-3 border border-[var(--color-border-light)] rounded-xl text-center space-y-1 bg-[var(--color-background)]/30 hover:border-[var(--color-accent)] transition-colors">
                      <div className="text-xs text-[var(--color-text-muted)]">充值包</div>
                      <div className="text-base font-bold text-[var(--color-text)] tabular-nums">¥{pkg.yuan}</div>
                      <div className="text-[10px] text-[var(--color-accent)] font-medium">约 {pkg.times} 次生成</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                <p className="font-medium text-[var(--color-primary)]">💡 充值指引：</p>
                <p>
                  由于高定算力通道限制，目前采用人工核账充值。请点击下方按钮复制管理员微信号，添加后即可快速到账。
                </p>
              </div>
            </div>

            {/* 底部 */}
            <div className="p-5 border-t border-[var(--color-border-light)] flex gap-3">
              <button
                onClick={async () => {
                  // clipboard API 在非安全上下文/权限被拒时会抛错，
                  // 不能未 await 就提示"已复制"误导用户
                  try {
                    await navigator.clipboard.writeText('silkmomo-concierge');
                    alert('管理员微信号 silkmomo-concierge 已复制到剪贴板，请前往微信添加。');
                  } catch {
                    alert('自动复制失败，请手动添加管理员微信号：silkmomo-concierge');
                  }
                }}
                className="btn-primary w-full cursor-pointer"
              >
                <span>复制管理员微信号 (silkmomo-concierge)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
