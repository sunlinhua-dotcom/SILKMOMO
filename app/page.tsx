'use client';

import { useState, useEffect, useCallback } from 'react';
import { ImageUploader } from '@/components/ImageUploader';
import { BodyTypeSelector } from '@/components/BodyTypeSelector';
import { SkinToneSelector } from '@/components/SkinToneSelector';
import { ProductShotModule } from '@/components/ProductShotModule';
import { SceneShotModule } from '@/components/SceneShotModule';
import { StylePackManager } from '@/components/StylePackManager';
import { BatchOutputMatrix } from '@/components/BatchOutputMatrix';
import { AIChatSidebar, AIChatBottomBar } from '@/components/AIChatBox';
import { TimeMachine } from '@/components/TimeMachine';
import { DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE, getDefaultShots } from '@/lib/models';
import { RecentProjectsStrip, RecentProjectsCompact } from '@/components/RecentProjectsStrip';
import { Wand2, ArrowRight, History, Camera, Trees, Sparkles, ChevronDown, Upload, Zap, Settings2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { UserNav } from '@/components/UserNav';
import { useBrandMemory } from '@/hooks/useBrandMemory';
import { useProductAnalysis } from '@/hooks/useProductAnalysis';
import type { CompressedImage } from '@/lib/image-compressor';
import { saveSnapshot, generateThumb, type FlowSnapshot } from '@/lib/image-library';
import { db } from '@/lib/db';
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
  const [selectedModelId] = useState<string>('');
  const [selectedBodyType, setSelectedBodyType] = useState<'slim' | 'standard' | 'curvy'>(DEFAULT_BODY_TYPE.id);
  const [selectedSkinTone, setSelectedSkinTone] = useState<'light' | 'medium' | 'deep'>(DEFAULT_SKIN_TONE.id);

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

  // ── 品牌记忆自动回填 ──
  useEffect(() => {
    if (brandPrefs.loaded && brandPrefs.hasProfile) {
      setSelectedBodyType(brandPrefs.defaultBodyType);
      setSelectedSkinTone(brandPrefs.defaultSkinTone);
      setActiveModule(brandPrefs.defaultModule);
    }
  }, [brandPrefs.loaded, brandPrefs.hasProfile, brandPrefs.defaultBodyType, brandPrefs.defaultSkinTone, brandPrefs.defaultModule]);

  // ── 上传产品图后自动触发 AI 分析 ──
  useEffect(() => {
    if (productImages.length > 0 && !analysis.done && !analysis.loading) {
      // 取第一张图分析
      analyze(productImages[0].base64);
    }
    if (productImages.length === 0) {
      resetAnalysis();
      setStep(1);
    }
  }, [productImages, analysis.done, analysis.loading, analyze, resetAnalysis]);

  // 上传完成后自动进入 Step 2
  useEffect(() => {
    if (productImages.length > 0 && step === 1) {
      setStep(2);
    }
  }, [productImages.length, step]);

  const canGenerate = productImages.length >= 1 && productImages.length <= 3 && (
    activeModule === 'product' ? selectedShots.length > 0 : sceneRefImages.length > 0
  );

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);

    try {
      const projectId = await db.projects.add({
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending',
        name: projectName || `${activeModule === 'product' ? '产品图' : '场景图'} ${new Date().toLocaleString('zh-CN')}`,
        moduleType: activeModule,
        modelId: selectedModelId || undefined,
        bodyType: selectedBodyType,
        skinTone: selectedSkinTone,
        skuType: activeModule === 'product' ? skuType : undefined,
        selectedShots: activeModule === 'product' ? JSON.stringify(selectedShots) : undefined,
        outputSize: activeModule === 'product' ? productOutputSize : undefined,
        customWidth: productOutputSize === 'custom' ? productCustomW : undefined,
        customHeight: productOutputSize === 'custom' ? productCustomH : undefined,
        sceneOutputSize: activeModule === 'scene' ? sceneOutputSize : undefined,
      });

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
        const countLabel = activeModule === 'product' ? `${selectedShots.length}张` : '1张';

        saveSnapshot({
          label: `${moduleLabel} · ${bodyLabel} · ${countLabel}`,
          module: activeModule,
          bodyType: selectedBodyType,
          skinTone: selectedSkinTone,
          selectedShots: activeModule === 'product' ? selectedShots : undefined,
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

  // 快速生成：使用默认7个镜次，不展开 Step 3
  const handleQuickGenerate = async () => {
    if (productImages.length < 1) return;
    const defaultShots = getDefaultShots(skuType);
    setSelectedShots(defaultShots);
    // 短延迟确保 state 已更新
    setTimeout(() => handleGenerate(), 50);
  };

  // ── 时光机回放 ──
  const handleReplay = useCallback((snapshot: FlowSnapshot) => {
    setActiveModule(snapshot.module);
    setSelectedBodyType(snapshot.bodyType as 'slim' | 'standard' | 'curvy');
    setSelectedSkinTone(snapshot.skinTone as 'light' | 'medium' | 'deep');
    if (snapshot.selectedShots) {
      setSelectedShots(snapshot.selectedShots);
    }
    if (snapshot.customPrompt) {
      setCustomPrompt(snapshot.customPrompt);
    }
    // 跳到 Step 2
    if (productImages.length > 0) {
      setStep(2);
    }
    // 滚到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [productImages.length]);

  return (
    <div className="min-h-screen bg-[var(--color-background)] pb-36 lg:pb-12">
      {/* ═══ 桌面端 AI 侧边栏（hidden on mobile） ═══ */}
      <AIChatSidebar
        context={`体型:${selectedBodyType} 肤色:${selectedSkinTone} 模式:${activeModule === 'product' ? '产品图' : '场景图'} 已上传:${productImages.length}张`}
        onActions={(actions) => {
          if (actions.bodyType) setSelectedBodyType(actions.bodyType);
          if (actions.skinTone) setSelectedSkinTone(actions.skinTone);
          if (actions.module === 'scene') setActiveModule('scene');
          if (actions.module === 'product') setActiveModule('product');
          if (actions.prompt) setCustomPrompt(prev => prev ? `${prev}, ${actions.prompt!}` : actions.prompt!);
          if (step < 2 && productImages.length > 0) setStep(2);
        }}
        onTriggerGenerate={() => { if (productImages.length > 0) handleQuickGenerate(); }}
      />

      {/* ═══ 移动端 AI 底栏（hidden on desktop） ═══ */}
      <AIChatBottomBar
        context={`体型:${selectedBodyType} 肤色:${selectedSkinTone} 模式:${activeModule === 'product' ? '产品图' : '场景图'} 已上传:${productImages.length}张`}
        onActions={(actions) => {
          if (actions.bodyType) setSelectedBodyType(actions.bodyType);
          if (actions.skinTone) setSelectedSkinTone(actions.skinTone);
          if (actions.module === 'scene') setActiveModule('scene');
          if (actions.module === 'product') setActiveModule('product');
          if (actions.prompt) setCustomPrompt(prev => prev ? `${prev}, ${actions.prompt!}` : actions.prompt!);
          if (step < 2 && productImages.length > 0) setStep(2);
        }}
        onTriggerGenerate={() => { if (productImages.length > 0) handleQuickGenerate(); }}
      />

      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]/30">
        <div className="max-w-[85rem] mx-auto px-4 sm:px-6 lg:px-12">
          <div className="flex items-center justify-between h-14 sm:h-20">
            <Link href="/" className="flex items-center gap-2.5 sm:gap-4 group min-w-0">
              <div className="w-8 h-8 sm:w-11 sm:h-11 flex-shrink-0 flex items-center justify-center">
                <Logo width={32} height={32} className="sm:w-[44px] sm:h-[44px]" />
              </div>
              <div className="min-w-0">
                <span className="font-serif text-base sm:text-2xl tracking-[0.1em] sm:tracking-[0.15em] text-[var(--color-primary)]">SILKMOMO</span>
                <span className="hidden sm:block text-[10px] tracking-[0.25em] uppercase text-[var(--color-text-muted)] mt-0.5">Maison de Création Digitale</span>
              </div>
            </Link>

            <div className="flex items-center gap-3 sm:gap-6 flex-shrink-0">
              <Link
                href="/tasks"
                className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] tracking-widest uppercase text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors duration-300"
              >
                <History className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">Archives</span>
              </Link>
              <UserNav />
            </div>
          </div>
        </div>
      </header>

      {/* 桌面端：主内容向右偏移以避让侧边栏（72 * 4 = 288px） */}
      <div className="lg:pl-72 transition-all duration-500">

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
                  else if (s.num === 3 && productImages.length > 0) setStep(3);
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
                <s.icon className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${step === s.num ? 'text-[var(--color-accent)]' : ''}`} strokeWidth={1.5} />
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
                description="1-3 张，白底图/模特图/场景图均可（必填）"
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
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                    <span>AI 正在分析产品特征...</span>
                  </div>
                </div>
              )}
              {analysis.done && analysis.description && (
                <div className="mt-3 p-3 rounded-xl bg-[rgba(201,168,108,0.06)] border border-[var(--color-accent)]/20 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-accent)] mb-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
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
                    onClick={() => setActiveModule('product')}
                    className={`
                      relative flex flex-col items-start gap-2 sm:gap-4 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] transition-all duration-500 overflow-hidden
                      ${activeModule === 'product'
                        ? 'bg-[#3D2E20] text-white shadow-xl sm:shadow-2xl'
                        : 'bg-[#FAFAFA] border border-transparent hover:border-[var(--color-border)] text-[var(--color-text)]'
                      }
                    `}
                  >
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center ${
                      activeModule === 'product' ? 'bg-white/10 text-white' : 'bg-white text-[var(--color-primary)] shadow-sm'
                    }`}>
                      <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <div className="text-left relative z-10">
                      <div className="font-serif text-base sm:text-xl tracking-wide">产品图</div>
                      <div className={`text-[10px] sm:text-xs mt-0.5 ${activeModule === 'product' ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>电商主图</div>
                    </div>
                    {activeModule === 'product' && <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-[var(--color-accent)]/20 rounded-full blur-3xl pointer-events-none"></div>}
                  </button>

                  <button
                    onClick={() => setActiveModule('scene')}
                    className={`
                      relative flex flex-col items-start gap-2 sm:gap-4 p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] transition-all duration-500 overflow-hidden
                      ${activeModule === 'scene'
                        ? 'bg-[#3D2E20] text-white shadow-xl sm:shadow-2xl'
                        : 'bg-[#FAFAFA] border border-transparent hover:border-[var(--color-border)] text-[var(--color-text)]'
                      }
                    `}
                  >
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center ${
                      activeModule === 'scene' ? 'bg-white/10 text-white' : 'bg-white text-[var(--color-primary)] shadow-sm'
                    }`}>
                      <Trees className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <div className="text-left relative z-10">
                      <div className="font-serif text-base sm:text-xl tracking-wide">场景图</div>
                      <div className={`text-[10px] sm:text-xs mt-0.5 ${activeModule === 'scene' ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>生活方式</div>
                    </div>
                    {activeModule === 'scene' && <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-[var(--color-accent)]/20 rounded-full blur-3xl pointer-events-none"></div>}
                  </button>
                </div>

                {/* 体型 + 肤色（并排紧凑） */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <BodyTypeSelector
                    selectedBodyType={selectedBodyType}
                    onSelect={setSelectedBodyType}
                  />
                  <SkinToneSelector
                    selectedSkinTone={selectedSkinTone}
                    onSelect={setSelectedSkinTone}
                  />
                </div>

                {/* 快速生成按钮 — 产品图模式 */}
                {activeModule === 'product' && (
                  <button
                    onClick={handleQuickGenerate}
                    disabled={isGenerating || productImages.length < 1}
                    className="btn-primary w-full"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>生成中...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-5 h-5" strokeWidth={1.5} />
                        <span>快速生成 {getDefaultShots(skuType).length} 张产品图</span>
                        <ArrowRight className="w-5 h-5" strokeWidth={1.5} />
                      </>
                    )}
                  </button>
                )}

                {/* 展开自定义选项 */}
                <button
                  onClick={() => { setStep(3); setShowAdvanced(true); }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>自定义镜次、模特参考图、配件和更多选项</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${step === 3 ? 'rotate-180' : ''}`} />
                </button>
              </div>
            )}

            {/* ═══ STEP 3：高级自定义 ═══ */}
            {step >= 3 && showAdvanced && (
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
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Project Name (Optional)"
                    className="w-full text-xl font-serif text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/50 border-0 border-b border-[var(--color-border-light)] focus:border-[var(--color-accent)] focus:ring-0 px-2 py-4 bg-transparent transition-colors"
                  />
                </div>

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
                      <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)] group-open:rotate-180 transition-transform duration-300" strokeWidth={1} />
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
                    setIsGenerating(true);

                    try {
                      const modelVar = config.variables.find(v => v.type === 'model');
                      const bodyVar = config.variables.find(v => v.type === 'bodyType');
                      const skinVar = config.variables.find(v => v.type === 'skinTone');
                      const sizeVar = config.variables.find(v => v.type === 'outputSize');

                      const models = modelVar?.values.length ? modelVar.values : [selectedModelId || ''];
                      const bodies = bodyVar?.values.length ? bodyVar.values : [selectedBodyType];
                      const skins = skinVar?.values.length ? skinVar.values : [selectedSkinTone];
                      const sizes = sizeVar?.values.length ? sizeVar.values : [activeModule === 'product' ? productOutputSize : sceneOutputSize];

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
                          skuType: activeModule === 'product' ? skuType : undefined,
                          selectedShots: activeModule === 'product' ? JSON.stringify(selectedShots) : undefined,
                          outputSize: activeModule === 'product' ? combo.outputSize : undefined,
                          sceneOutputSize: activeModule === 'scene' ? combo.outputSize : undefined,
                        });

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
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                  className="btn-primary w-full"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>生成中...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-5 h-5" strokeWidth={1.5} />
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
                      {canGenerate && <ArrowRight className="w-5 h-5" strokeWidth={1.5} />}
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
            onClick={handleQuickGenerate}
            disabled={isGenerating || productImages.length < 1}
            className="btn-primary w-full"
          >
            {isGenerating ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>生成中...</span>
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" strokeWidth={1.5} />
                <span>快速生成 {getDefaultShots(skuType).length} 张</span>
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
              SILKMOMO
            </p>
            <p className="text-[9px] sm:text-[10px] tracking-widest uppercase text-[var(--color-text-muted)]">
              © 2025 · Haute Couture, AI-Powered
            </p>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}
