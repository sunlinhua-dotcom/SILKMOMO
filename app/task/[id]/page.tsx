'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import { db, type Project, type ImageItem } from '@/lib/db';
import { type ImageEngine } from '@/components/EngineSelector';
import { ImageLightbox } from '@/components/ImageLightbox';
import { AIChatSidebar } from '@/components/AIChatBox';
import {
  getGenerationCostFen,
  getGenerationQualityEtaSeconds,
  normalizeGenerationQuality,
  type GenerationQuality,
} from '@/lib/billing-constants';
import { DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE } from '@/lib/models';
import { type CompressedImage } from '@/lib/image-compressor';
import { recoverPendingImages } from '@/lib/pending-recovery';
import {
  backupMatchesImage,
  buildProductGroupsFromImages,
  formatYuan,
  getDisplayErrorMessage,
  getModelIdentityMode,
  getSceneGroupMode,
  parseSelectedShots,
  sortImagesByPrimaryKey,
} from '@/lib/task-page-helpers';
import { useToast } from '@/components/ui/Toast';
import { useBalance } from '@/hooks/useBalance';
import { useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useTaskGeneration, type TaskInputImages } from '@/hooks/useTaskGeneration';
import { TaskHeader } from '@/components/task/TaskHeader';
import { AdjustParamsModal } from '@/components/task/AdjustParamsModal';
import { RechargeModal } from '@/components/task/RechargeModal';
import { GeneratingPanel } from '@/components/task/GeneratingPanel';
import { InputImagesCard } from '@/components/task/InputImagesCard';
import { ParamChips } from '@/components/task/ParamChips';
import { StartGenerationPanel } from '@/components/task/StartGenerationPanel';
import { PartialCompletionPrompts } from '@/components/task/PartialCompletionPrompts';
import { ResultsSection } from '@/components/task/ResultsSection';
import { FailedPanel } from '@/components/task/FailedPanel';
import { getTaskParamSummary } from '@/components/task/taskParams';

/** 生成中离开页面的确认文案：对照服务端「客户端断开」行为写（当前镜次跑完入缓冲，后续镜次停止） */
const LEAVE_GENERATING_MESSAGE =
  '现在离开会中断本页与服务器的连接。正在生成的这一张会在服务器上继续完成，已扣费的图不会丢，回到本任务页会自动补回；还没开始的镜次会停止（不扣费），需要回来点“生成剩余”继续。';

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = Number(params.id);
  const toast = useToast();
  const { balanceFen, status: balanceStatus } = useBalance();

  const [project, setProject] = useState<Project | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [inputImages, setInputImages] = useState<TaskInputImages>({
    products: [], modelRefs: [], bgRefs: [], sceneRefs: [], accessories: [],
  });
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 混款告警：黄条，不是失败，不打断生成
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [trialDone, setTrialDone] = useState(false);
  // 在途 SSE 的 AbortController：loadTaskData 要读它（孤儿 processing 判断），生成 hook 要写它
  const abortControllerRef = useRef<AbortController | null>(null);
  // ?autostart=1 自动开跑的同步锁：React 严格模式会重复执行 effect，刷新 / 后退也会再进来，
  // 一旦做出「跑 / 不跑」的决定就置位，整个组件生命周期内不再重复，避免重复扣费。
  const autostartHandledRef = useRef(false);
  // 余额不足时的充值引导弹窗（值为这次动作需要的费用，null = 关闭）
  const [rechargeNeedFen, setRechargeNeedFen] = useState<number | null>(null);

  // --- 调整参数面板 State ---
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newBodyType, setNewBodyType] = useState<'slim' | 'standard' | 'curvy'>(DEFAULT_BODY_TYPE.id);
  const [newSkinTone, setNewSkinTone] = useState<'light' | 'medium' | 'deep'>(DEFAULT_SKIN_TONE.id);
  const [newEngine, setNewEngine] = useState<ImageEngine>('gemini');
  const [newQuality, setNewQuality] = useState<GenerationQuality>('medium');
  const [newStyleImages, setNewStyleImages] = useState<CompressedImage[]>([]);

  // --- 输入图片放大预览 ---
  const [previewImage, setPreviewImage] = useState<{ src: string; label: string } | null>(null);

  // 「快速重做」带 ?redo=1 进来时，加载完成后滚到生成结果区，让用户直接在每张图上重生成
  const resultsRef = useRef<HTMLDivElement>(null);
  const redoScrolledRef = useRef(false);

  const loadTaskData = useCallback(async () => {
    try {
      const task = await db.projects.get(taskId);
      if (!task) {
        router.push('/');
        return;
      }
      // 断网丢图的根治点：生成成功但没送达客户端的图，服务端还在交接缓冲里留着。
      // 进任务页时先补拉一次，把它们捡回本地 —— 用户不必重新生成、也不必再付一次钱。
      await recoverPendingImages(taskId);

      const allImages = await db.images.where('projectId').equals(taskId).toArray();
      const results = allImages.filter(img => img.type === 'result');
      const backups = allImages.filter(img => img.type === 'result_backup');

      // 孤儿 processing 恢复：生成是客户端 SSE 驱动的，生成中刷新/关闭页面后
      // 状态会永远停在 processing，而 processing 态没有任何操作按钮 → 任务死锁。
      // 页面挂载时（本组件无 in-flight 请求）发现 processing 即视为被中断，按已有产出回退状态。
      if (task.status === 'processing' && !abortControllerRef.current) {
        const recoveredStatus: Project['status'] = results.length > 0 ? 'completed' : 'pending';
        await db.projects.update(taskId, {
          status: recoveredStatus,
          lastError: results.length > 0 ? '上次生成被中断（页面刷新或关闭），已保留生成完成的图片' : undefined,
          updatedAt: new Date(),
        });
        task.status = recoveredStatus;
        task.lastError = results.length > 0 ? '上次生成被中断（页面刷新或关闭），已保留生成完成的图片' : undefined;
      }

      // 关联备份：严格按 shotIndex 匹配（产品图）；shotIndex 都是 undefined 时按场景图唯一匹配
      const imagesWithBackups = results.map(img => {
        const backup = backups.find(b => backupMatchesImage(b, img.shotIndex));
        return {
          ...img,
          backup: backup ? { id: backup.id!, data: backup.data } : undefined
        };
      });

      setProject(task);
      setImages(imagesWithBackups);
      setInputImages({
        products: sortImagesByPrimaryKey(allImages.filter(img => img.type === 'product')),
        modelRefs: allImages.filter(img => img.type === 'model_ref'),
        bgRefs: allImages.filter(img => img.type === 'bg_ref'),
        sceneRefs: sortImagesByPrimaryKey(allImages.filter(img => img.type === 'scene_ref')),
        accessories: allImages.filter(img => img.type === 'accessory'),
      });
      // 同步当前参数到调整面板
      setNewModelId(task.modelId || '');
      setNewBodyType(task.bodyType || DEFAULT_BODY_TYPE.id);
      setNewSkinTone(task.skinTone || DEFAULT_SKIN_TONE.id);
      setNewEngine(task.engine === 'openai' ? 'openai' : 'gemini');
      setNewQuality(normalizeGenerationQuality(task.generationQuality));
      // 恢复持久化的错误信息（刷新页面后仍可看到原因）：
      // failed 的失败原因，以及 completed 但中途有镜次失败/余额不足的提示
      if ((task.status === 'failed' || task.status === 'completed') && task.lastError) {
        setErrorMessage(task.lastError);
      }
    } catch (error) {
      console.error('加载任务失败:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId, router]);

  useEffect(() => {
    loadTaskData();
  }, [loadTaskData]);

  // 「快速重做」入口：URL 带 ?redo=1 时，结果加载好后滚动到生成结果区（只执行一次）
  useEffect(() => {
    if (loading || redoScrolledRef.current) return;
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('redo') !== '1') return;
    if (images.length === 0) return;
    redoScrolledRef.current = true;
    // 等一帧确保结果 DOM 已挂载
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [loading, images.length]);

  // 目标张数：产品图=所选镜次数；组图=参考图/产品组数；单张场景图=1
  const getShotCount = () => {
    if (!project) return 7;
    if (project.moduleType === 'scene') {
      // 组图：目标张数 = lookbook 参考图张数
      if (project.sceneGroup) {
        return getSceneGroupMode(project) === 'products'
          ? buildProductGroupsFromImages(inputImages.products).length
          : inputImages.sceneRefs.length;
      }
      // 单张场景图：永远 1 张（以前落到下面按产品镜次解析，会算出 5 张）
      return 1;
    }
    return parseSelectedShots(project.selectedShots).length;
  };

  // ── 费用与余额 ──
  // 单价口径与首页、服务端一致：getGenerationCostFen(引擎, 画质)。
  // 请求实际用的是 newEngine / newQuality（见 handleStartGeneration 的 effectiveEngine），所以标价也按它们算。
  const unitCostFen = getGenerationCostFen(newEngine, newQuality);
  const fullRunCount = getShotCount();
  const fullRunCostFen = fullRunCount * unitCostFen;
  const affordability = (costFen: number): 'ok' | 'insufficient' | 'unknown' => {
    if (balanceStatus !== 'ready' || balanceFen === null) return 'unknown';
    return balanceFen >= costFen ? 'ok' : 'insufficient';
  };
  /** 花钱动作的统一入口：已确认余额不足就引导充值，不发请求；余额未知时放行（服务端会再校验）。 */
  const runPaidAction = (costFen: number, action: () => void) => {
    if (affordability(costFen) === 'insufficient') {
      setRechargeNeedFen(costFen);
      return;
    }
    action();
  };
  /** 预计耗时（秒）：与生成中的 ETA 同一口径——首张 + 其余张数 × 单张。 */
  const estimateRunSeconds = (count: number) => {
    const first = newEngine === 'openai' ? getGenerationQualityEtaSeconds(newQuality) : 25;
    const perShot = newEngine === 'openai' ? getGenerationQualityEtaSeconds(newQuality) : 15;
    return first + Math.max(0, count - 1) * perShot;
  };

  // 生成控制器（SSE 流式生成 / 取消 / 重做 / 版本取舍 / 断线自动补齐），见 hooks/useTaskGeneration.ts
  const {
    generating,
    progress,
    waitingMessage,
    generationPhase,
    generationErrors,
    startedAt,
    etaDeadline,
    shotNotices,
    liveImages,
    pendingChatPromptRef,
    handleTrialGeneration,
    handleGenerateRemaining,
    handleStartGeneration,
    handleRetryFailedShot,
    cancelGeneration,
    handleRegenerateWithNewParams,
    handleRegenerate,
    handleAcceptNewVersion,
    handleRejectNewVersion,
    handleAiTriggerGenerate,
  } = useTaskGeneration({
    taskId, project, setProject, images, setImages, inputImages, loadTaskData, abortControllerRef,
    newEngine, newQuality, newModelId, newBodyType, newSkinTone, newStyleImages, setNewStyleImages,
    setShowAdjustPanel, setErrorMessage, setWarningMessage, setTrialDone, setRechargeNeedFen,
    unitCostFen, fullRunCount, fullRunCostFen, affordability,
  });

  // 生成中离开会中断这条 SSE 连接：刷新 / 关闭 / 站内链接 / 浏览器后退都先让用户确认（见 hooks/useLeaveGuard）。
  // 文案对照服务端 app/api/generate/stream/route.ts：客户端断开后，当前这一张照常跑完并写入交接缓冲（已扣费、
  // 回来会补拉），但还没开始的镜次会停止、不扣费。
  useLeaveGuard(generating, LEAVE_GENERATING_MESSAGE);

  // 组件卸载时清理 SSE 连接，避免泄漏
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // 生成按钮文案
  const getGenerateLabel = () => {
    if (!project) return '生成';
    const moduleType = project.moduleType || 'product';
    if (moduleType === 'product') {
      return `全部生成 ${parseSelectedShots(project.selectedShots).length} 张产品图`;
    }
    if (project.sceneGroup) {
      return getSceneGroupMode(project) === 'products'
        ? `生成 ${buildProductGroupsFromImages(inputImages.products).length} 张同景换品图`
        : `生成 ${inputImages.sceneRefs.length} 张组图`;
    }
    return '开始生成场景图';
  };

  // ?autostart=1：首页「快速生成」建好任务后跳过来，在这里自动全量开跑一次（等同点「全部生成」，
  // 不是「先试 1 张」——首页标价按全量算）。同步 ref 锁保证严格模式双调用 / 刷新 / 后退都不会重复扣费。
  useEffect(() => {
    if (loading || !project || autostartHandledRef.current) return;
    if (new URLSearchParams(window.location.search).get('autostart') !== '1') return;
    const clearParam = () => router.replace(`/task/${taskId}`, { scroll: false });

    // 任务已经开过跑（刷新 / 后退回到带参数的地址）：只清掉参数，绝不再跑
    if (project.status !== 'pending' || images.length > 0 || generating) {
      autostartHandledRef.current = true;
      clearParam();
      return;
    }
    if (inputImages.products.length === 0) {
      autostartHandledRef.current = true;
      clearParam();
      toast.error('缺少产品输入图，没有自动开始，请补充输入图后手动生成');
      return;
    }
    if (balanceStatus === 'loading') return; // 等余额确认后再决定，不抢跑
    autostartHandledRef.current = true;
    clearParam();
    if (balanceStatus !== 'ready' || balanceFen === null) {
      toast.info('暂时无法确认余额，没有自动开始，请点击下方按钮手动生成');
      return;
    }
    if (balanceFen < fullRunCostFen) {
      toast.error(`余额不足：全部生成需要 ${formatYuan(fullRunCostFen)}，当前余额 ${formatYuan(balanceFen)}，没有自动开始`);
      return;
    }
    void handleStartGeneration();
    // handleStartGeneration 依赖当前渲染的 state（每次渲染都是新闭包），故不进依赖数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, project, images.length, generating, inputImages.products.length, balanceStatus, balanceFen, fullRunCostFen, router, taskId, toast]);

  const productGroupLabels = (() => {
    if (!project || project.moduleType !== 'scene' || !project.sceneGroup || getSceneGroupMode(project) !== 'products') {
      return [];
    }
    if (project.sceneGroupCategories) {
      try {
        const parsed = JSON.parse(project.sceneGroupCategories);
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
          return parsed as string[];
        }
      } catch { /* ignore */ }
    }
    return buildProductGroupsFromImages(inputImages.products).map((group, index) => group.label || `产品 ${index + 1}`);
  })();

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-light)] flex items-center justify-center mx-auto mb-4">
            <Loader className="w-6 h-6 text-[var(--color-accent)] animate-spin" aria-hidden="true" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">加载中…</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <p className="text-[var(--color-text-muted)]">任务不存在</p>
      </div>
    );
  }

  const moduleType = project.moduleType || 'product';
  const isFollowSceneGroupTask = moduleType === 'scene' && !!project.sceneGroup && getModelIdentityMode(project) === 'follow_scene';
  const remainingErrorCount = Math.max(0, getShotCount() - images.length);
  const displayErrorMessage = errorMessage
    ? getDisplayErrorMessage(errorMessage, images.length, remainingErrorCount)
    : null;

  // 已生成图片数追上目标数 = 等待 SSE done 事件收尾的窗口期
  const isFinishingUp = liveImages.length >= progress.total && progress.total > 0;

  const phaseTitle = (() => {
    if (generationPhase === 'analyzing') return '正在分析服装特征…';
    if (isFinishingUp) return '图片处理中，即将完成…';
    if (moduleType === 'product') return `已生成 ${liveImages.length} / ${progress.total} 张`;
    return '正在生成场景图…';
  })();

  const phaseSubLabel = (() => {
    if (generationPhase === 'analyzing') return '服装分析中';
    if (isFinishingUp) return '收尾中';
    if (moduleType === 'product') return `正在生成镜次 #${progress.shotIndex}`;
    return '场景图';
  })();

  const previewInput = (src: string, label: string) => setPreviewImage({ src, label });

  const paramSummary = getTaskParamSummary(project);
  const { currentModelName, currentBodyTypeName, currentSkinToneName, currentEngineId } = paramSummary;

  // 任务页面的 AI Chat：当用户描述调整时，触发对当前任务的 customPrompt 重做
  const taskChatContext = isFollowSceneGroupTask
    ? `当前任务: ${project.name}, 模块: 场景图, 组图模式: 贴近场景模特，肤色·体型·发型跟随场景图, 已生成: ${images.length}张`
    : `当前任务: ${project.name}, 模块: ${moduleType === 'product' ? '产品图' : '场景图'}, 体型: ${currentBodyTypeName}, 肤色: ${currentSkinToneName}, 已生成: ${images.length}张`;

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* 任务侧的 AI Chat 侧边栏：用户可以描述要调整什么，AI 提取参数后整任务重做 */}
      <AIChatSidebar
        context={taskChatContext}
        hideBodySkinQuickTags={isFollowSceneGroupTask}
        emptyStateHint={`💬 描述要调整什么\n例如："模特表情更柔和"、"整体亮度提高"\n\nAI 会用你的描述重做这个任务的所有图片`}
        placeholder="描述要调整什么..."
        onActions={(actions) => {
          // 单图细节调整建议在结果图上 hover → ✨ 按钮
          // 这里的 chat 走整任务重做流程
          if (!isFollowSceneGroupTask && actions.bodyType && actions.bodyType !== project.bodyType) {
            setNewBodyType(actions.bodyType);
          }
          if (!isFollowSceneGroupTask && actions.skinTone && actions.skinTone !== project.skinTone) {
            setNewSkinTone(actions.skinTone);
          }
          // 捕获 prompt，下一步 onTriggerGenerate 时附加到生成请求
          if (actions.prompt) {
            pendingChatPromptRef.current = actions.prompt;
          }
        }}
        onTriggerGenerate={() => void handleAiTriggerGenerate()}
      />

      {/* 桌面端：主内容向右偏移以避让 AI 侧边栏（72 * 4 = 288px） */}
      <div className="lg:pl-72 transition-all duration-500">

      {/* 顶部导航 */}
      <TaskHeader
        project={project}
        moduleType={moduleType}
        generating={generating}
        liveCount={liveImages.length}
        progressTotal={progress.total}
        onAdjust={() => setShowAdjustPanel(true)}
      />

      {/* 调整参数面板：统一用 <Modal>（Esc 关闭、焦点陷阱与归还、滚动锁、手机端底部抽屉） */}
      <AdjustParamsModal
        open={showAdjustPanel}
        onClose={() => setShowAdjustPanel(false)}
        insufficient={affordability(fullRunCostFen) === 'insufficient'}
        onRecharge={() => setRechargeNeedFen(fullRunCostFen)}
        onConfirm={() => runPaidAction(fullRunCostFen, () => void handleRegenerateWithNewParams())}
        fullRunCount={fullRunCount}
        fullRunCostFen={fullRunCostFen}
        isFollowSceneGroupTask={isFollowSceneGroupTask}
        moduleType={moduleType}
        currentModelName={currentModelName}
        currentBodyTypeName={currentBodyTypeName}
        currentSkinToneName={currentSkinToneName}
        newEngine={newEngine}
        setNewEngine={setNewEngine}
        newQuality={newQuality}
        setNewQuality={setNewQuality}
        newModelId={newModelId}
        setNewModelId={setNewModelId}
        newBodyType={newBodyType}
        setNewBodyType={setNewBodyType}
        newSkinTone={newSkinTone}
        setNewSkinTone={setNewSkinTone}
        newStyleImages={newStyleImages}
        setNewStyleImages={setNewStyleImages}
      />

      {/* 余额不足：引导联系管理员充值（与首页口径一致） */}
      <RechargeModal
        needFen={rechargeNeedFen}
        balanceFen={balanceFen}
        onClose={() => setRechargeNeedFen(null)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* 生成中状态（SSE 实时） */}
        {generating && (
          <GeneratingPanel
            generationPhase={generationPhase}
            phaseTitle={phaseTitle}
            phaseSubLabel={phaseSubLabel}
            waitingMessage={waitingMessage}
            startedAt={startedAt}
            etaDeadline={etaDeadline}
            isFinishingUp={isFinishingUp}
            progress={progress}
            liveImages={liveImages}
            moduleType={moduleType}
            currentEngineId={currentEngineId}
            shotNotices={shotNotices}
            generationErrors={generationErrors}
            unitCostFen={unitCostFen}
            onCancel={cancelGeneration}
            handleRegenerate={handleRegenerate}
            handleAcceptNewVersion={handleAcceptNewVersion}
            handleRejectNewVersion={handleRejectNewVersion}
          />
        )}

        {/* 输入图片概览 */}
        <InputImagesCard inputImages={inputImages} onPreview={previewInput}>
          <ParamChips
            project={project}
            moduleType={moduleType}
            isFollowSceneGroupTask={isFollowSceneGroupTask}
            summary={paramSummary}
          />
        </InputImagesCard>

        {/* 开始生成按钮 */}
        {project.status === 'pending' && !generating && (
          <StartGenerationPanel
            moduleType={moduleType}
            shotCount={getShotCount()}
            generateLabel={getGenerateLabel()}
            newEngine={newEngine}
            setNewEngine={setNewEngine}
            newQuality={newQuality}
            setNewQuality={setNewQuality}
            newModelId={newModelId}
            setNewModelId={setNewModelId}
            isFollowSceneGroupTask={isFollowSceneGroupTask}
            unitCostFen={unitCostFen}
            fullRunCostFen={fullRunCostFen}
            fullRunCount={fullRunCount}
            affordability={affordability}
            setRechargeNeedFen={setRechargeNeedFen}
            runPaidAction={runPaidAction}
            estimateRunSeconds={estimateRunSeconds}
            onTrial={handleTrialGeneration}
            onStart={() => handleStartGeneration()}
          />
        )}

        {/* 试生成完成 / 组图部分完成 → 生成剩余按钮 */}
        <PartialCompletionPrompts
          project={project}
          moduleType={moduleType}
          generating={generating}
          trialDone={trialDone}
          imageCount={images.length}
          shotCount={getShotCount()}
          unitCostFen={unitCostFen}
          affordability={affordability}
          setRechargeNeedFen={setRechargeNeedFen}
          runPaidAction={runPaidAction}
          onGenerateRemaining={() => handleGenerateRemaining()}
          onAdjust={() => setShowAdjustPanel(true)}
        />

        {/* 结果展示 */}
        {images.length > 0 && (
          <ResultsSection
            images={images}
            resultsRef={resultsRef}
            warningMessage={warningMessage}
            generating={generating}
            projectStatus={project.status}
            displayErrorMessage={displayErrorMessage}
            shotNotices={shotNotices}
            productGroupLabels={productGroupLabels}
            unitCostFen={unitCostFen}
            handleRegenerate={handleRegenerate}
            handleAcceptNewVersion={handleAcceptNewVersion}
            handleRejectNewVersion={handleRejectNewVersion}
          />
        )}

        {previewImage && (
          <ImageLightbox
            src={previewImage.src}
            alt={previewImage.label}
            onClose={() => setPreviewImage(null)}
            zIndex={110}
            footer={
              <div className="px-4 py-1.5 bg-white/10 backdrop-blur-md text-white text-sm rounded-full whitespace-nowrap">
                {previewImage.label}
              </div>
            }
          />
        )}

        {/* 失败状态 */}
        {project.status === 'failed' && images.length === 0 && (
          <FailedPanel
            taskId={taskId}
            displayErrorMessage={displayErrorMessage}
            generationErrors={generationErrors}
            generating={generating}
            unitCostFen={unitCostFen}
            onRetryShot={handleRetryFailedShot}
            onRetry={() => handleGenerateRemaining()}
          />
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-[var(--color-border-light)] py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-[var(--color-text-muted)]">
            SILXINE © 2026 · 奢华丝绸，AI 赋能
          </p>
        </div>
      </footer>
      </div>
    </div>
  );
}
