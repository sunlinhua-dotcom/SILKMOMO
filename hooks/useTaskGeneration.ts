'use client';

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { db, type Project, type ImageItem } from '@/lib/db';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { type ImageEngine } from '@/components/EngineSelector';
import { type ShotNotice } from '@/components/task/ShotNotices';
import {
  getGenerationQualityEtaSeconds,
  normalizeGenerationQuality,
  type GenerationQuality,
} from '@/lib/billing-constants';
import { PRODUCT_SHOTS, DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE } from '@/lib/models';
import { type CompressedImage } from '@/lib/image-compressor';
import {
  PAID_IMAGE_RECOVERY_ERROR,
  finalizeGeneration,
  mergeRunLocalResults,
  mergeRecoveredShots,
  missingShotIndexes,
  reconcileStalledChunk,
  recoveryGate,
  shouldScheduleAutomaticFill,
} from '@/lib/generation-recovery';
import {
  STALL_BYTES_MS,
  STALL_EVENT_MS,
  fetchPendingImage,
  recoverPendingImages,
  releasePendingImage,
  toCompressedAnchor,
} from '@/lib/pending-recovery';
import {
  GenerationHttpError,
  IDEMPOTENT_NOTICE_PATTERN,
  backupMatchesImage,
  buildFriendlyConnectionErrorMessage,
  buildFriendlyUnexpectedErrorMessage,
  buildProductGroupsFromImages,
  formatYuan,
  getKnownUserFacingErrorMessage,
  getModelIdentityMode,
  getSceneGroupMode,
  isConnectionLayerError,
  parseSelectedShots,
  sortImagesByPrimaryKey,
  type GenerationError,
  type GenerationPhase,
} from '@/lib/task-page-helpers';
import { refreshBalance } from '@/hooks/useBalance';

/** 任务页的输入图分组（loadTaskData 按 type 分好） */
export interface TaskInputImages {
  products: ImageItem[];
  modelRefs: ImageItem[];
  bgRefs: ImageItem[];
  sceneRefs: ImageItem[];
  accessories: ImageItem[];
}

export interface UseTaskGenerationArgs {
  taskId: number;
  project: Project | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  images: ImageItem[];
  setImages: Dispatch<SetStateAction<ImageItem[]>>;
  inputImages: TaskInputImages;
  /** 重读 IndexedDB 并刷新页面 state（含一次补拉），由页面持有 */
  loadTaskData: () => Promise<void>;
  /** 在途 SSE 的 AbortController：页面的 loadTaskData 要读它（孤儿 processing 判断），所以由页面创建后传入 */
  abortControllerRef: MutableRefObject<AbortController | null>;
  /** 调整参数面板里的当前选择（生成请求按这些值发） */
  newEngine: ImageEngine;
  newQuality: GenerationQuality;
  newModelId: string;
  newBodyType: 'slim' | 'standard' | 'curvy';
  newSkinTone: 'light' | 'medium' | 'deep';
  newStyleImages: CompressedImage[];
  setNewStyleImages: Dispatch<SetStateAction<CompressedImage[]>>;
  setShowAdjustPanel: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setWarningMessage: Dispatch<SetStateAction<string | null>>;
  setTrialDone: Dispatch<SetStateAction<boolean>>;
  setRechargeNeedFen: Dispatch<SetStateAction<number | null>>;
  /** 费用口径（页面按余额 / 引擎 / 画质算好） */
  unitCostFen: number;
  fullRunCount: number;
  fullRunCostFen: number;
  affordability: (costFen: number) => 'ok' | 'insufficient' | 'unknown';
}

/**
 * 任务页的生成控制器：SSE 流式生成（全量 / 试生成 / 剩余 / 单图重做统一入口）、取消、
 * 调整参数重做、版本取舍、断线自动补齐。从 app/task/[id]/page.tsx 原样搬出，逻辑零改动。
 * 返回值里的 state 与 handler 由页面直接渲染 / 绑定。
 */
export function useTaskGeneration(args: UseTaskGenerationArgs) {
  const {
    taskId, project, setProject, images, setImages, inputImages, loadTaskData, abortControllerRef,
    newEngine, newQuality, newModelId, newBodyType, newSkinTone, newStyleImages, setNewStyleImages,
    setShowAdjustPanel, setErrorMessage, setWarningMessage, setTrialDone, setRechargeNeedFen,
    unitCostFen, fullRunCount, fullRunCostFen, affordability,
  } = args;
  const confirm = useConfirm();

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 1, shotIndex: 0 });
  const [waitingMessage, setWaitingMessage] = useState('');

  // ═══ SSE 实时状态 ═══
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>('idle');
  const [generationErrors, setGenerationErrors] = useState<GenerationError[]>([]);
  // 秒表 / 剩余时间的每秒刷新放在 <GenerationProgress> 内部；页面只记起点和预计完成时刻（极少变化）
  const [startedAt, setStartedAt] = useState(0);
  const [etaDeadline, setEtaDeadline] = useState(0);
  // 服务端幂等命中的「该镜次的提示」（非失败）
  const [shotNotices, setShotNotices] = useState<ShotNotice[]>([]);
  const [liveImages, setLiveImages] = useState<ImageItem[]>([]); // 生成中实时追加的图片

  // 防止双击 重做 同一张图：第一次点击在 setGenerating(true) 之前还有窗口期，
  // 用 ref 立刻置位，第二次点击直接 return（避免备份图被自己刚生成的"备份"匹配并物理删除）
  const regenLockRef = useRef(false);
  // 主生成入口同样有窗口期：guard 检查后还有两次 IndexedDB await 才 setGenerating(true)，
  // 双击"全部生成/先试1张/重试"会并行跑两条 SSE 流 → 双倍扣费。同步 ref 锁先行置位。
  const startLockRef = useRef(false);
  // 断线自动补齐：整轮只补一次（autoRetried），补的动作排到本轮彻底收尾之后（pendingAutoRetry），
  // 因为 handleStartGeneration 开头有 generating / startLockRef 双重闸门，同步递归会被自己挡回去。
  const autoRetriedRef = useRef(false);
  const pendingAutoRetryRunIdRef = useRef<string | null>(null);
  // "调整参数重新生成"（含 AI 聊天整任务重做）的同步锁
  const regenParamsLockRef = useRef(false);
  // AI 触发整任务重做时确认框正在显示，避免连续触发叠出多个确认
  const aiConfirmingRef = useRef(false);
  // 单张重做的确认弹窗是否打开：防止确认期间连点别的图再弹第二个
  const regenConfirmingRef = useRef(false);
  // AI Chat 的"待应用 prompt"：actions.prompt 在 onActions 里捕获，onTriggerGenerate 时使用
  const pendingChatPromptRef = useRef<string>('');


  // 断线自动补齐：等本轮 generating 落回 false（闸门全部释放、state 已刷新）再触发，
  // 复用「生成剩余」那套缺口计算，保证只补真缺的那几张。
  // 计费安全：每张图服务端独立扣费、失败自动退款，补的是用户没拿到的那几张，不会重复扣。
  useEffect(() => {
    if (generating || !pendingAutoRetryRunIdRef.current) return;
    const runId = pendingAutoRetryRunIdRef.current;
    pendingAutoRetryRunIdRef.current = null;
    void handleGenerateRemaining(runId);
    // handleGenerateRemaining 依赖当前渲染的 state，故不进依赖数组（每次渲染都是新闭包）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  const handleTrialGeneration = async () => {
    if (!project || generating || inputImages.products.length === 0) return;
    const moduleType = project.moduleType || 'product';
    if (moduleType !== 'product') return handleStartGeneration();
    const selectedShotIndexes = parseSelectedShots(project.selectedShots);
    // 显式标记试生成：不能用 overrideShotIndexes.length === 1 推断，
    // 否则单图重做成功也会误触发"试生成完成"横幅
    await handleStartGeneration([selectedShotIndexes[0]], undefined, { isTrial: true });
  };

  const handleGenerateRemaining = async (existingRunId?: string) => {
    if (!project || generating) return;
    const showNoopMessage = !existingRunId;
    if (inputImages.products.length === 0) {
      if (showNoopMessage) setErrorMessage('缺少产品输入图，无法重试生成');
      return;
    }
    const runId = existingRunId || crypto.randomUUID();
    const gate = recoveryGate(await recoverPendingImages(taskId));
    if (!gate.proceed) {
      setErrorMessage(gate.message);
      return;
    }

    const moduleType = project.moduleType || 'product';
    const isGroup = moduleType === 'scene' && !!project.sceneGroup;

    const existingResults = await db.images
      .where('projectId').equals(taskId)
      .filter(img => img.type === 'result')
      .toArray();
    const existingShotIndexes = existingResults
      .map(img => img.shotIndex)
      .filter(Boolean) as number[];

    if (isGroup) {
      // 组图：swap 目标是参考图序号；products 目标是产品组序号，补齐缺失的那几张
      const N = getSceneGroupMode(project) === 'products'
        ? buildProductGroupsFromImages(inputImages.products).length
        : inputImages.sceneRefs.length;
      const remaining: number[] = [];
      for (let s = 1; s <= N; s++) {
        if (!existingShotIndexes.includes(s)) remaining.push(s);
      }
      if (remaining.length === 0) {
        if (showNoopMessage) setErrorMessage('当前没有待补齐的组图；如需重做，请使用图片上的重新生成');
        return;
      }
      await handleStartGeneration(remaining, undefined, { runId, recoveryChecked: true });
      return;
    }

    if (moduleType === 'scene') {
      if (existingResults.length === 0) {
        await handleStartGeneration(undefined, undefined, { runId, recoveryChecked: true });
      } else if (showNoopMessage) {
        setErrorMessage('当前场景图已存在；如需重做，请使用图片上的重新生成');
      }
      return;
    }

    const selectedShotIndexes = parseSelectedShots(project.selectedShots);
    const remainingIndexes = missingShotIndexes(selectedShotIndexes, new Set(existingShotIndexes));

    if (remainingIndexes.length === 0) {
      if (showNoopMessage) setErrorMessage('当前没有待补齐的图片；如需重做，请使用图片上的重新生成');
      return;
    }
    await handleStartGeneration(remainingIndexes, undefined, { runId, recoveryChecked: true });
  };

  // ===== [E] SSE 流式生成 · 开始 =====
  // ═══════════════════════════════════════════════════════════════
  // 核心：SSE 流式生成（全量 / 试生成 / 剩余 / 单图重做，统一入口）
  // overrideShotIndexes: 不传 = 用 project 里的配置；传 = 只生成指定镜次
  // customPrompt: 用户对该次生成的额外要求（追加到 prompt）
  // ═══════════════════════════════════════════════════════════════
  const handleStartGeneration = async (
    overrideShotIndexes?: number[],
    customPrompt?: string,
    opts?: { isTrial?: boolean; runId?: string; recoveryChecked?: boolean }
  ) => {
    if (!project || inputImages.products.length === 0) return;
    // 防重复点击：generating 是异步 state，guard 后到 setGenerating(true) 之间
    // 还有多个 await（IndexedDB 读取）——双击会双双放行并行扣费。
    // startLockRef 同步置位封死这个窗口。
    if (generating || abortControllerRef.current || startLockRef.current) return;
    startLockRef.current = true;
    const runId = opts?.runId || crypto.randomUUID();

    if (!opts?.recoveryChecked) {
      const gate = recoveryGate(await recoverPendingImages(taskId));
      if (!gate.proceed) {
        setErrorMessage(gate.message);
        startLockRef.current = false;
        return;
      }
    }

    // —— 关键：从 DB 重新取 project + inputImages ——
    // handleRegenerateWithNewParams 会先写 DB 再调本函数，但 React state（project / inputImages）
    // 在同一同步任务里还没刷新 → 闭包仍是旧值。直接从 DB 读取保证拿到的是最新参数和最新输入图。
    const freshProject = await db.projects.get(taskId);
    if (!freshProject) {
      startLockRef.current = false;
      return;
    }
    const allImgs = await db.images.where('projectId').equals(taskId).toArray();
    const freshInputs = {
      products: sortImagesByPrimaryKey(allImgs.filter(i => i.type === 'product')),
      modelRefs: allImgs.filter(i => i.type === 'model_ref'),
      bgRefs: allImgs.filter(i => i.type === 'bg_ref'),
      sceneRefs: sortImagesByPrimaryKey(allImgs.filter(i => i.type === 'scene_ref')),
      accessories: allImgs.filter(i => i.type === 'accessory'),
    };
    if (freshInputs.products.length === 0) {
      startLockRef.current = false;
      return;
    }

    const moduleType = freshProject.moduleType || 'product';
    const selectedShotIndexes = overrideShotIndexes ?? parseSelectedShots(freshProject.selectedShots);
    // 组图（换装）：迭代维度是「参考图序号」，不是产品镜次
    const isGroup = moduleType === 'scene' && !!freshProject.sceneGroup;
    const sceneGroupMode = getSceneGroupMode(freshProject);
    const modelIdentityMode = getModelIdentityMode(freshProject);
    const followSceneLocksModelParams = isGroup && modelIdentityMode === 'follow_scene';
    const shouldUseSceneGroupAnchor = isGroup && (modelIdentityMode === 'fresh' || modelIdentityMode === 'follow_scene');
    const productGroups = isGroup && sceneGroupMode === 'products'
      ? buildProductGroupsFromImages(freshInputs.products)
      : undefined;
    const groupSourceCount = isGroup
      ? (sceneGroupMode === 'products' ? (productGroups?.length || 0) : freshInputs.sceneRefs.length)
      : 0;
    // 组图目标序号（1-based）：swap=参考图序号；products=产品组序号。override 传了就是单张重做/补齐。
    const groupTargetIndexes = isGroup
      ? (overrideShotIndexes ?? Array.from({ length: groupSourceCount }, (_, i) => i + 1))
      : undefined;
    const groupTotal = isGroup ? (groupTargetIndexes?.length ?? 0) : 0;
    if (isGroup && groupSourceCount === 0) {
      startLockRef.current = false;
      return;
    }
    // 组图：用户上传替换的主品品类（供后端点明换哪几件）
    let groupGarmentCategories: string[] | undefined;
    if (isGroup && sceneGroupMode === 'swap' && freshProject.sceneGroupCategories) {
      try {
        const parsed = JSON.parse(freshProject.sceneGroupCategories);
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) groupGarmentCategories = parsed;
      } catch { /* ignore */ }
    }
    // 组图重做/补齐（指定了目标序号）时，取已存锚或一张已有结果图作身份锚，让补的图与首批同一个新人/同一张派生脸；
    // 全量生成（未指定 target）不带锚，由服务端预生成身份锚，失败时才回退首张成功图自锚。注意单张重做前该图已被降级为 result_backup，
    // 故按 type==='result' 过滤能自然排除正在重做的那张。
    let groupAnchor: { data: string; mimeType: string } | undefined;
    if (shouldUseSceneGroupAnchor) {
      const savedAnchor = allImgs.find(i => i.type === 'anchor');
      if (savedAnchor) {
        groupAnchor = await toCompressedAnchor({ data: savedAnchor.data, mimeType: savedAnchor.mimeType });
      }
    }
    if (shouldUseSceneGroupAnchor && !groupAnchor && overrideShotIndexes && overrideShotIndexes.length > 0) {
      const doneSiblings = allImgs
        .filter(i => i.type === 'result' && typeof i.shotIndex === 'number' && !overrideShotIndexes.includes(i.shotIndex))
        .sort((a, b) => (a.shotIndex as number) - (b.shotIndex as number));
      if (doneSiblings.length > 0) {
        // 结果图是全尺寸 PNG，必须压缩后再当锚，否则每张请求都要重传数 MB
        groupAnchor = await toCompressedAnchor({
          data: doneSiblings[0].data,
          mimeType: doneSiblings[0].mimeType,
        });
      }
    }

    // —— 持久化微调的 customPrompt ——
    if (customPrompt !== undefined) {
      await db.projects.update(taskId, { customPrompt });
      // 延迟更新 project
      setProject(prev => prev ? { ...prev, customPrompt } : null);
    }
    const effectiveCustomPrompt = customPrompt !== undefined ? customPrompt : (freshProject.customPrompt || undefined);

    // —— 重置状态 ——
    setGenerating(true);
    setErrorMessage(null);
    setWarningMessage(null);
    setGenerationErrors([]);
    setGenerationPhase('analyzing');
    setShotNotices([]);
    setWaitingMessage('');

    // —— 初始化预估剩余时间(按引擎区分:GPT Image 2 实测 ~150-235s/张,Gemini ~20-35s/张;
    //     之前不分引擎统一按 15s/张 估算,GPT 会出现"预计剩余 17 秒"实跑 4 分钟的误导)——
    const etaFirstShotSec = newEngine === 'openai' ? getGenerationQualityEtaSeconds(newQuality) : 25;
    const etaPerShotSec = newEngine === 'openai' ? getGenerationQualityEtaSeconds(newQuality) : 15;
    const groupEtaCount = Math.max(1, groupTotal);
    const initialSeconds = moduleType === 'scene'
      ? (isGroup
          ? etaFirstShotSec + (groupEtaCount - 1) * etaPerShotSec
          : etaFirstShotSec)
      : (selectedShotIndexes.length === 1
          ? etaFirstShotSec
          : etaFirstShotSec + (selectedShotIndexes.length - 1) * etaPerShotSec);
    // 秒表本体在 <GenerationProgress> 里自己走；这里只记起点和预计完成时刻
    const timerStart = Date.now();
    setStartedAt(timerStart);
    setEtaDeadline(timerStart + initialSeconds * 1000);

    setLiveImages([]);
    setTrialDone(false);

    // —— AbortController（取消用）——
    const cancelController = new AbortController();
    abortControllerRef.current = cancelController;

    // catch/finally 也要能读到，所以放 try 外
    let successCount = 0;
    let successfulShotIndexes = new Set<number>();
    let lastFatalError: string | null = null;
    // 定稿时要按错误的真实来源选文案：停滞＝连接中断，服务端报错＝原样保留
    // （后者已经带了「已自动退款」，套成「连接中断」会误导用户去点重连）。
    let lastErrorWasStall = false;
    let wasCancelled = false;
    const restoredShotIndexes = new Set<number>();
    const grandTotal = isGroup ? groupTotal : (moduleType === 'product' ? selectedShotIndexes.length : 1);
    const expectedShotIndexes = isGroup
      ? (groupTargetIndexes || [])
      : moduleType === 'product'
        ? selectedShotIndexes
        : [0];
    let fatalStop = false;

    try {
      // —— 用户在 pending 状态用快选 / AI 聊天改了模特/引擎/体型/肤色：持久化覆盖 ——
      const effectiveModelId = followSceneLocksModelParams ? '' : (newModelId || freshProject.modelId || '');
      const effectiveEngine: 'gemini' | 'openai' = newEngine;
      const effectiveQuality = normalizeGenerationQuality(newQuality);
      const effectiveBodyType = followSceneLocksModelParams ? '' : (newBodyType || freshProject.bodyType || DEFAULT_BODY_TYPE.id);
      const effectiveSkinTone = followSceneLocksModelParams ? '' : (newSkinTone || freshProject.skinTone || DEFAULT_SKIN_TONE.id);
      const modelChanged = !followSceneLocksModelParams && effectiveModelId !== (freshProject.modelId || '');
      const engineChanged = effectiveEngine !== (freshProject.engine || 'gemini');
      const qualityChanged = effectiveQuality !== normalizeGenerationQuality(freshProject.generationQuality);
      const bodyTypeChanged = !followSceneLocksModelParams && effectiveBodyType !== (freshProject.bodyType || DEFAULT_BODY_TYPE.id);
      const skinToneChanged = !followSceneLocksModelParams && effectiveSkinTone !== (freshProject.skinTone || DEFAULT_SKIN_TONE.id);
      if (modelChanged || engineChanged || qualityChanged || bodyTypeChanged || skinToneChanged) {
        const projectPatch: Partial<Project> = {
          engine: effectiveEngine,
          generationQuality: effectiveQuality,
          updatedAt: new Date(),
        };
        if (!followSceneLocksModelParams) {
          projectPatch.modelId = effectiveModelId || undefined;
          projectPatch.bodyType = effectiveBodyType as Project['bodyType'];
          projectPatch.skinTone = effectiveSkinTone as Project['skinTone'];
        }
        await db.projects.update(taskId, projectPatch);
        setProject(prev => prev ? {
          ...prev,
          engine: effectiveEngine,
          generationQuality: effectiveQuality,
          ...(followSceneLocksModelParams ? {} : {
            modelId: effectiveModelId || undefined,
            bodyType: effectiveBodyType as Project['bodyType'],
            skinTone: effectiveSkinTone as Project['skinTone'],
          }),
        } : null);
      }

      await db.projects.update(taskId, { status: 'processing', lastError: undefined });
      setProject(prev => prev ? { ...prev, status: 'processing', lastError: undefined } : null);

      const productImgs = freshInputs.products.map(img => ({ data: img.data, mimeType: img.mimeType }));

      // ── 分块生成 ──
      // GPT(openai)每张 ~3 分钟,多张串在一个 SSE 请求里会撞路由预算/网关连接时长上限。
      // 产品图仍每块 ≤3 张；sceneGroup 每块 1 张,但本函数会在 for 循环里自动接续下一块。
      const PRODUCT_CHUNK_SIZE = 3;
      const SCENE_GROUP_CHUNK_SIZE = 1;
      const targetIndexesForChunking = expectedShotIndexes;
      const chunkSize = isGroup ? SCENE_GROUP_CHUNK_SIZE : PRODUCT_CHUNK_SIZE;
      const shouldChunk =
        effectiveEngine === 'openai' &&
        ((moduleType === 'product' && selectedShotIndexes.length > PRODUCT_CHUNK_SIZE) ||
          (isGroup && targetIndexesForChunking.length > SCENE_GROUP_CHUNK_SIZE));
      const genChunks: number[][] =
        shouldChunk
          ? Array.from({ length: Math.ceil(targetIndexesForChunking.length / chunkSize) },
              (_, i) => targetIndexesForChunking.slice(i * chunkSize, i * chunkSize + chunkSize))
          : [targetIndexesForChunking];
      let anchorForChunk: { data: string; mimeType: string } | undefined;
      let groupAnchorForChunk: { data: string; mimeType: string } | undefined = groupAnchor;
      // 服装分析结果跨块复用：swap 模式下每块都会重跑一次同一张产品图的分析
      // （6 张图＝6 次上游调用）。首块通过 garment 事件下发，之后回传即可。
      let garmentDescriptionForChunk = '';
      let doneSoFar = 0; // 已完成(成功或失败)的镜次数,用于跨块累计进度显示

      for (let chunkIdx = 0; chunkIdx < genChunks.length; chunkIdx++) {
      const chunkShots = genChunks[chunkIdx];
      // 恰好在两块之间取消:此时没有在途 fetch 会抛 AbortError,必须在这里标记为取消,
      // 否则会掉进"统一定稿"分支显示"已完成"。fatal 则直接停止后续块。
      if (cancelController.signal.aborted) { wasCancelled = true; setGenerationPhase('cancelled'); break; }
      if (fatalStop) break;

      // 每块独立 controller：看门狗只终止当前块；用户取消则由外层 controller 广播。
      const chunkController = new AbortController();
      const abortChunkForUserCancel = () => chunkController.abort();
      cancelController.signal.addEventListener('abort', abortChunkForUserCancel, { once: true });
      let stalledOut: 'bytes' | 'event' | null = null;
      let lastByteAt = Date.now();
      let lastEventAt = Date.now();
      const stallEventLimit = STALL_EVENT_MS[newEngine];
      const stallTimer = setInterval(() => {
        if (chunkController.signal.aborted) return;
        const now = Date.now();
        if (now - lastByteAt > STALL_BYTES_MS) stalledOut = 'bytes';
        else if (now - lastEventAt > stallEventLimit) stalledOut = 'event';
        if (stalledOut) chunkController.abort();
      }, 5_000);

      try {
      const response = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: chunkController.signal,
        body: JSON.stringify({
          taskId,
          moduleType,
          productImages: sceneGroupMode === 'products' ? [] : productImgs,
          productGroups: sceneGroupMode === 'products' ? productGroups : undefined,
          modelRefImages: freshInputs.modelRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          bgRefImages: freshInputs.bgRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          sceneRefImages: freshInputs.sceneRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          accessoryImages: freshInputs.accessories.map(img => ({ data: img.data, mimeType: img.mimeType })),
          modelId: followSceneLocksModelParams ? undefined : (effectiveModelId || undefined),
          bodyType: followSceneLocksModelParams ? undefined : effectiveBodyType,
          skinTone: followSceneLocksModelParams ? undefined : effectiveSkinTone,
          engine: effectiveEngine,
          quality: effectiveEngine === 'openai' ? effectiveQuality : undefined,
          anchorImage: moduleType === 'product' ? anchorForChunk : undefined,
          selectedShotIndexes: moduleType === 'product' ? chunkShots : selectedShotIndexes,
          outputSize: freshProject.outputSize,
          sceneOutputSize: freshProject.sceneOutputSize,
          // 自定义尺寸的实际宽高：服务端据此换算比例，否则 'custom' 永远按 3:4 生成
          customWidth: freshProject.customWidth,
          customHeight: freshProject.customHeight,
          sceneHasModel: freshProject.sceneHasModel !== false,
          sceneGroup: isGroup || undefined,
          sceneGroupMode: isGroup ? sceneGroupMode : undefined,
          modelIdentityMode: isGroup ? modelIdentityMode : undefined,
          sceneGroupTargetIndexes: isGroup ? chunkShots : undefined,
          sceneGroupAnchor: shouldUseSceneGroupAnchor ? groupAnchorForChunk : undefined,
          // 用户在脸库里挑的脸 ≠ 单张重做回传的锚：后者才需要「贴合已通过组图」的口径
          anchorIsUserChosen: freshProject.modelFaceChosen === true,
          sceneGroupGarmentCategories: isGroup ? groupGarmentCategories : undefined,
          customPrompt: effectiveCustomPrompt || undefined,
          garmentDescription: garmentDescriptionForChunk || undefined,
          runId,
        }),
      });

      if (response.status === 401) {
        throw new Error('登录已过期，请重新登录后再试');
      }
      if (!response.ok || !response.body) {
        // 服务端开流前拒绝：429 = 同一账号在途生成过多，413 = 请求体过大。
        // 响应体是 JSON `{error}`，解析出来给用户看人话，不再把原始 JSON 糊在页面上。
        // 这类错误不进「连接中断」分支，也不会被自动补齐重试（lastErrorWasStall 保持 false）。
        const rawBody = await response.text().catch(() => '');
        let serverMessage = '';
        try {
          const parsed = JSON.parse(rawBody) as { error?: unknown };
          if (typeof parsed.error === 'string') serverMessage = parsed.error.trim();
        } catch { /* 不是 JSON，用下面的兜底文案 */ }
        const friendly = response.status === 429
          ? (serverMessage || '同时在生成的任务太多了，请等当前任务完成后再试')
          : response.status === 413
            ? (serverMessage || '上传的图片总体积太大，请减少参考图数量或压缩后重试')
            : (serverMessage || `服务暂时无法处理这次请求（HTTP ${response.status}），请稍后重试`);
        throw new GenerationHttpError(response.status, friendly);
      }
      // 兜底：若被中间层重定向到登录页（HTML 200），不能当成空 SSE 流静默吞掉
      const sseContentType = response.headers.get('content-type') || '';
      if (!sseContentType.includes('text/event-stream')) {
        throw new Error('登录已过期或服务响应异常，请重新登录后再试');
      }

      // —— 读取 SSE 流 ——
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = ''; // 必须在 while 外，跨 chunk 保持事件类型
      console.log('[SSE] 开始读取流...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[SSE] 流结束, successCount=', successCount);
          break;
        }

        // 收到任何字节（含 25s 一次的 keep-alive 注释行）= 连接还活着
        lastByteAt = Date.now();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        // 缓冲区里还留着半条事件 = 服务端正在推一条大 data:（result 事件是一张
        // 4~5MB 的 base64 图，整张就是一行），下载期间一次 JSON.parse 都跑不到，
        // lastEventAt 会一直冻住 → 事件看门狗在「下载一张图」的过程中倒计时并掐断连接。
        // 0731 线上实测：生成 23:08:01 就完成了（t_generate=56.3s），客户端 23:09:46
        // 才收到图，中间 105s 全在传这一行。这正是服务端记的
        // "client disconnected before delivery" —— 图生成成功了，是在下行路上被掐的。
        // 只要还在收半条事件，就说明服务端在推进，不能判停滞；连接真死了由字节看门狗兜。
        if (buffer.length > 0) lastEventAt = Date.now();

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const eventType = currentEventType; // 捕获当前事件类型
            currentEventType = ''; // 消费后重置，防止下一个 data 行误匹配
            let payload: Record<string, unknown>;
            try { payload = JSON.parse(line.slice(6)); } catch { continue; }

            // 实质事件（非 keep-alive）= 服务端确实在推进
            lastEventAt = Date.now();

            console.log(`[SSE] 事件: ${eventType}`, eventType === 'result' ? '(有图片数据)' : payload);

            if (eventType === 'status') {
              if (payload.heartbeat === true) {
                if (typeof payload.message === 'string') setWaitingMessage(payload.message);
                continue;
              }
              const phase = payload.phase as string;
              // 只在"本次运行还没产出任何图"时进入"分析中"相位。两种回跳都要 gate:
              // ① 后续块(chunkIdx>0)的请求也会推 analyzing;② products 模式每个产品组开头
              // 都会推一次 analyzing。若不 gate,进度条会从已完成进度回跳到 8%(可见倒退)。
              setGenerationPhase(
                phase === 'analyzing' && chunkIdx === 0 && successCount === 0 ? 'analyzing' : 'generating'
              );
              if (payload.current !== undefined) {
                // 跨块累计:块内 current 加上此前块已完成数,总数用 grandTotal(否则多块时显示"4/2")
                setProgress({
                  current: doneSoFar + (payload.current as number),
                  total: grandTotal,
                  shotIndex: (payload.shotIndex as number) ?? 0,
                });
              }

            } else if (eventType === 'anchor') {
              const pendingId = typeof payload.pendingId === 'string' ? payload.pendingId : '';
              let imageData = payload.imageData as string | undefined;
              let anchorMime = typeof payload.mimeType === 'string' && payload.mimeType
                ? payload.mimeType
                : 'image/png';
              if (!imageData && pendingId) {
                const fetched = await fetchPendingImage(pendingId);
                if (!fetched) {
                  console.error('[anchor 取回] 失败，继续生成并回退首张成功图');
                  continue;
                }
                imageData = fetched.data;
                anchorMime = fetched.mimeType || anchorMime;
              }
              if (shouldUseSceneGroupAnchor && imageData) {
                // 服务端已经先压过一版（shrinkAnchorForClient），类型以它给的为准；
                // 压过的体积落在阈值以下，toCompressedAnchor 会原样放行、不会二次编码。
                const compressedAnchor = await toCompressedAnchor({ data: imageData, mimeType: anchorMime });
                try {
                  const existingAnchor = await db.images.where('projectId').equals(taskId).filter(i => i.type === 'anchor').first();
                  if (existingAnchor?.id) {
                    await db.images.update(existingAnchor.id, compressedAnchor);
                  } else {
                    await db.images.add({ projectId: taskId, type: 'anchor', ...compressedAnchor });
                  }
                  groupAnchorForChunk = compressedAnchor;
                  if (pendingId) void releasePendingImage(pendingId);
                } catch (e) {
                  console.error('[anchor 落库] 失败，继续生成并回退首张成功图:', e);
                }
              }

            } else if (eventType === 'warning') {
              // 目前只有混款告警：卖家把两件不同单品混在一次上传里，出图会串味。
              // 不是错误，不打断生成，用黄条提示，让用户下次拆开传。
              const msg = payload.message;
              if (typeof msg === 'string' && msg.trim()) {
                setWarningMessage(msg.trim());
                console.warn('[SSE] 混款告警:', msg);
              }

            } else if (eventType === 'garment') {
              const desc = payload.description;
              if (typeof desc === 'string' && desc.trim()) {
                garmentDescriptionForChunk = desc.trim();
                console.log('[SSE] 收到服装分析，后续分块复用，不再重复调用上游');
              }

            } else if (eventType === 'result') {
              const shotIndex = payload.shotIndex as number;
              const currentN = payload.current as number;
              const pendingId = typeof payload.pendingId === 'string' ? payload.pendingId : '';
              // 新链路：SSE 只推 id，图走普通 HTTP 取；服务端交接缓冲不可用时才回退直推。
              let imageData = payload.imageData as string;
              if (!imageData && pendingId) {
                const fetched = await fetchPendingImage(pendingId);
                if (!fetched) {
                  // 图仍在服务端等着，重进任务页时的补拉会捡回来；这里不计成功，
                  // 免得 UI 显示已出图而本地其实没有。
                  console.error(`[交接缓冲] #${shotIndex} 取图未成功，留待补拉`);
                  continue;
                }
                imageData = fetched.data;
              }
              console.log(`[SSE] 图片 #${shotIndex} 大小: ${imageData?.length ?? 0} chars`);
              // 跨块累计进度(用 grandTotal 作分母,doneSoFar 作偏移)
              const overallCurrent = doneSoFar + currentN;
              setProgress({ current: overallCurrent, total: grandTotal, shotIndex });

              // 动态修正预估剩余时间：整组剩余数量 × 单张预估（按引擎）
              const remaining = Math.max(0, grandTotal - overallCurrent);
              setEtaDeadline(Date.now() + remaining * etaPerShotSec * 1000);

              // 实时写入 IndexedDB + 追加到 liveImages
              // 只有产品图才按镜次查 shotConfig；场景组图的 shotIndex 是「参考图序号(1..N)」，
              // 若也去 PRODUCT_SHOTS.find 会错配到产品镜次(1-9)，污染 frameType/角度/hasModel。
              const shotConfig = moduleType === 'product'
                ? PRODUCT_SHOTS.find(s => s.index === shotIndex)
                : undefined;
              const persistedShotIndex = shotIndex > 0 ? shotIndex : undefined;
              const resultHasModel = moduleType === 'scene'
                ? freshProject.sceneHasModel !== false
                : shotConfig?.hasModel;
              const resultGroupIndex = isGroup && sceneGroupMode === 'products' ? shotIndex : undefined;
              const newImgId = await db.images.add({
                projectId: taskId,
                type: 'result',
                data: imageData,
                mimeType: 'image/png',
                shotIndex: persistedShotIndex,
                frameType: shotConfig?.frameType,
                shootingAngle: shotConfig?.angle,
                hasModel: resultHasModel,
                groupIndex: resultGroupIndex,
                imageType: shotConfig
                  ? (shotConfig.frameType === 'full_body' ? 'full_body'
                    : shotConfig.frameType === 'upper_body' ? 'half_body' : 'close_up')
                  : 'hero',
                index: shotIndex,
              });
              successfulShotIndexes.add(shotIndex);
              successCount = successfulShotIndexes.size;
              console.log(`[SSE] 图片 #${shotIndex} 已落库, success: ${successCount}`);
              // 已落 IndexedDB，通知服务端删掉交接缓冲行（删不掉由 TTL 兜底）
              if (pendingId) void releasePendingImage(pendingId);
              // 如果这是单张重做产生的新图，对应位置可能已有 result_backup（旧版图） —
              // 关联起来，让实时画廊也能立刻显示 "对比旧版 / 还原旧版" 工具条
              const existingBackup = await db.images
                .where('projectId').equals(taskId)
                .filter(i => i.type === 'result_backup' && backupMatchesImage(i, persistedShotIndex))
                .first();
              const newImg: ImageItem = {
                id: newImgId as number,
                projectId: taskId,
                type: 'result',
                data: imageData,
                mimeType: 'image/png',
                shotIndex: persistedShotIndex,
                hasModel: resultHasModel,
                groupIndex: resultGroupIndex,
                imageType: shotConfig
                  ? (shotConfig.frameType === 'full_body' ? 'full_body'
                    : shotConfig.frameType === 'upper_body' ? 'half_body' : 'close_up')
                  : 'hero',
                index: shotIndex,
                backup: existingBackup ? { id: existingBackup.id!, data: existingBackup.data } : undefined,
              };
              setLiveImages(prev => [...prev, newImg]);

            } else if (eventType === 'error') {
              const errPayload: GenerationError = {
                shotIndex: payload.shotIndex as number,
                message: payload.message as string,
                fatal: payload.fatal as boolean,
              };
              console.error(`[SSE] 错误事件:`, errPayload);
              if (
                payload.fatal !== true
                && typeof errPayload.message === 'string'
                && IDEMPOTENT_NOTICE_PATTERN.test(errPayload.message)
              ) {
                // 幂等命中：服务端没有重复出图，也没有重复扣费。这只是「该镜次的提示」，
                // 不是生成失败，不进失败列表；也不置 lastErrorWasStall，所以不会触发自动补齐循环。
                // 图若已交付，收尾时的补拉 / 刷新页面即可取回。
                setShotNotices(prev => [...prev, { shotIndex: errPayload.shotIndex, message: errPayload.message }]);
                lastFatalError = errPayload.message;
                lastErrorWasStall = false;
                continue;
              }
              setGenerationErrors(prev => [...prev, errPayload]);
              if (payload.fatal) {
                const msg = payload.message as string;
                setErrorMessage(msg);
                lastFatalError = msg;
                lastErrorWasStall = false;
                fatalStop = true; // fatal(余额不足/扣费失败)→ 循环外的 guard 会停掉后续块,避免多发请求
              } else {
                // 非 fatal 也记录最后一条 SSE 错误（成功生成 0 张时作为兜底原因）
                lastFatalError = payload.message as string;
                lastErrorWasStall = false;
              }

            } else if (eventType === 'done') {
              // 单块结束:不在这里定稿(多块时会被后续块覆盖);仅累计本块已完成镜次数
              // 供跨块进度偏移。全部块跑完后在循环外统一定稿。
              console.log(`[SSE] 分块 done, successCount(累计)=${successCount}`);
              const d = payload as { successCount?: number; failedCount?: number };
              doneSoFar += (d.successCount ?? 0) + (d.failedCount ?? 0);
            }
          }
        }
      }
      // ── 单块 SSE 读取结束 ──
      // 首块跑完后抓一张"有模特"的成功图作为后续块的 anchor,让整组保持同一个模特身份
      if (moduleType === 'product' && !anchorForChunk) {
        try {
          const a = await db.images.where('projectId').equals(taskId)
            .filter(i => i.type === 'result' && i.hasModel === true).first();
          // 结果图是全尺寸 PNG，压缩后再当锚，避免后续每块都重传数 MB
          if (a) anchorForChunk = await toCompressedAnchor({ data: a.data, mimeType: 'image/png' });
        } catch { /* 抓不到 anchor 不阻塞,后续块会各自锚定 */ }
      }
      if (shouldUseSceneGroupAnchor && !groupAnchorForChunk) {
        try {
          const savedAnchor = await db.images.where('projectId').equals(taskId).filter(i => i.type === 'anchor').first();
          if (savedAnchor) {
            groupAnchorForChunk = await toCompressedAnchor({ data: savedAnchor.data, mimeType: savedAnchor.mimeType });
          } else {
            const a = await db.images.where('projectId').equals(taskId)
              .filter(i => i.type === 'result' && i.hasModel === true).first();
            if (a) groupAnchorForChunk = await toCompressedAnchor({ data: a.data, mimeType: 'image/png' });
          }
        } catch { /* 抓不到 anchor 不阻塞，服务端会回退首张成功图 */ }
      }
      } catch (err) {
        console.error('[生图前端] 分块 catch:', {
          error: err,
          stalledOut,
          sinceLastEventMs: Date.now() - lastEventAt,
          sinceLastByteMs: Date.now() - lastByteAt,
          chunkIdx,
        });
        if (cancelController.signal.aborted) {
          wasCancelled = true;
          setGenerationPhase('cancelled');
          setErrorMessage(successCount > 0 ? `已取消生成（保留已生成的 ${successCount} 张）` : '已取消生成');
          break;
        }
        if (stalledOut !== null) {
          const recovery = await recoverPendingImages(taskId, chunkShots);
          const gate = recoveryGate(recovery);
          if (!gate.proceed) {
            setErrorMessage(gate.message);
            lastFatalError = gate.message;
            lastErrorWasStall = false;
            fatalStop = true;
            break;
          }
          const stalled = reconcileStalledChunk({
            successfulShots: successfulShotIndexes,
            recoveredShotIndexes: gate.recoveredShotIndexes,
            expectedShots: expectedShotIndexes,
            stalledChunkShots: chunkShots,
          });
          successfulShotIndexes = stalled.successfulShots;
          successCount = successfulShotIndexes.size;
          doneSoFar += chunkShots.length;
          const remainingCount = Math.max(0, grandTotal - successCount);
          const message = buildFriendlyConnectionErrorMessage(successCount, remainingCount);
          for (const shotIndex of chunkShots) {
            setGenerationErrors(prev => [...prev, { shotIndex, message, fatal: false }]);
          }
          setErrorMessage(message);
          lastFatalError = message;
          lastErrorWasStall = true;
          setGenerationPhase('generating');
          setProgress({
            current: Math.min(doneSoFar, grandTotal),
            total: grandTotal,
            shotIndex: chunkShots.at(-1) ?? 0,
          });
          continue;
        }
        throw err;
      } finally {
        clearInterval(stallTimer);
        cancelController.signal.removeEventListener('abort', abortChunkForUserCancel);
      }
      } // ← 关闭分块 for 循环

    } catch (err) {
      console.error('[生图前端] catch 错误:', err);
      if ((err as Error).name === 'AbortError' && cancelController.signal.aborted) {
        // 用户主动取消 ≠ 失败：不能把任务标成 failed + "生成失败（catch）"。
        // 最终状态在 finally 的备份还原之后按实际产出决定（见 wasCancelled 分支）。
        wasCancelled = true;
        setGenerationPhase('cancelled');
        setErrorMessage(successCount > 0 ? `已取消生成（保留已生成的 ${successCount} 张）` : '已取消生成');
      } else {
        // 已成功生成的图保留：最终状态在 finally 的补拉之后按实际产出决定
        const remainingCount = Math.max(0, grandTotal - successCount);
        const knownMessage = getKnownUserFacingErrorMessage(err);
        const msg = knownMessage
          ?? (isConnectionLayerError(err)
            ? buildFriendlyConnectionErrorMessage(successCount, remainingCount)
            : buildFriendlyUnexpectedErrorMessage(successCount, remainingCount));
        console.error('[生图前端] 原始错误详情:', err);
        setErrorMessage(msg);
        lastFatalError = msg;
        setGenerationPhase('error');
      }
    } finally {
      abortControllerRef.current = null;

      // 数据安全：扫描所有 backup，按 shotIndex 对应是否有新 result 决定
      //   - 有新图 → backup 是过时副本，但保留供用户对比 / 还原（用户主动操作才删）
      //     已经在 imagesWithBackups 里关联过，这里不动
      //   - 无新图（生成失败/取消）→ 把 backup 还原为 result，避免用户看不到旧图
      try {
        const backups = await db.images
          .where('projectId').equals(taskId)
          .filter(i => i.type === 'result_backup')
          .toArray();
        for (const b of backups) {
          const hasNewResult = await db.images
            .where('projectId').equals(taskId)
            .filter(i => i.type === 'result' && i.shotIndex === b.shotIndex)
            .count();
          if (hasNewResult === 0) {
            await db.images.update(b.id!, { type: 'result' });
            restoredShotIndexes.add(b.shotIndex ?? 0);
          }
        }
      } catch (e) {
        console.error('[backup 还原] 失败:', e);
      }

      // 用户取消：备份已还原完毕，按 DB 里的实际产出决定最终状态
      // （单图重做被取消时任务原本就有图 → completed；全新任务取消 → 回到 pending 可重新开始）
      if (wasCancelled) {
        try {
          const resultCount = await db.images
            .where('projectId').equals(taskId)
            .filter(i => i.type === 'result')
            .count();
          const cancelStatus: Project['status'] = resultCount > 0 ? 'completed' : 'pending';
          await db.projects.update(taskId, { status: cancelStatus, lastError: undefined, updatedAt: new Date() });
        } catch (e) {
          console.error('[取消状态回写] 失败:', e);
        }
      } else {
        try {
          const recovery = await recoverPendingImages(taskId, expectedShotIndexes);
          const gate = recoveryGate(recovery);
          successfulShotIndexes = mergeRecoveredShots(
            successfulShotIndexes,
            recovery.recoveredShotIndexes,
            expectedShotIndexes,
          );
          const localResults = await db.images
            .where('projectId').equals(taskId)
            .filter(i => i.type === 'result')
            .toArray();
          successfulShotIndexes = mergeRunLocalResults({
            successfulShots: successfulShotIndexes,
            localShotIndexes: localResults.map(i => i.shotIndex ?? 0),
            expectedShots: expectedShotIndexes,
            restoredShotIndexes,
          });
          successCount = successfulShotIndexes.size;

          if (!gate.proceed) {
            lastFatalError = gate.message;
            lastErrorWasStall = false;
            fatalStop = true;
          }
          const outcome = finalizeGeneration({
            expectedShots: expectedShotIndexes,
            successfulShots: successfulShotIndexes,
            lastError: lastFatalError,
            lastErrorWasStall,
          });
          const finalRemaining = outcome.remaining.length;
          const persistedError = !gate.proceed
            ? finalRemaining > 0 ? gate.message : undefined
            : finalRemaining > 0 && lastErrorWasStall
              ? buildFriendlyConnectionErrorMessage(successCount, finalRemaining)
              : outcome.lastError;

          if (shouldScheduleAutomaticFill({
            remaining: outcome.remaining,
            lastErrorWasStall,
            fatalStop,
            alreadyRetried: autoRetriedRef.current,
          })) {
            autoRetriedRef.current = true;
            pendingAutoRetryRunIdRef.current = runId;
            console.log(`[自动补齐] 连接抖动导致缺 ${finalRemaining} 张，本轮结束后以同一 runId 自动补一次`);
          }
          setErrorMessage(persistedError ?? null);
          await db.projects.update(taskId, {
            status: outcome.status,
            lastError: persistedError,
            updatedAt: new Date(),
          });
          setProject(prev => prev ? { ...prev, status: outcome.status, lastError: persistedError } : null);
          setGenerationPhase(successCount > 0 ? 'done' : 'error');
          if (opts?.isTrial && successCount === 1) setTrialDone(true);
        } catch (e) {
          console.error('[最终补拉/状态回写] 失败:', e);
          setErrorMessage(PAID_IMAGE_RECOVERY_ERROR);
          await db.projects.update(taskId, {
            status: 'failed',
            lastError: PAID_IMAGE_RECOVERY_ERROR,
            updatedAt: new Date(),
          });
        }
      }

      // 刷新最终图片列表后再释放锁并切 generating=false。这样自动补齐 effect 看到
      // pendingAutoRetryRunIdRef 时，所有本轮状态与同步锁都已经稳定。
      try {
        await loadTaskData();
      } finally {
        startLockRef.current = false;
        setGenerating(false);
        // 扣费 / 退款都已落定：刷新右上与各处共享的余额
        void refreshBalance();
      }
    }
  };

  // ===== [E] SSE 流式生成 · 结束 =====

  const handleRetryFailedShot = async (shotIndex: number) => {
    if (generating || startLockRef.current) return;
    const runId = crypto.randomUUID();
    const gate = recoveryGate(await recoverPendingImages(taskId, [shotIndex]));
    if (!gate.proceed) {
      setErrorMessage(gate.message);
      return;
    }
    const alreadyRecovered = await db.images
      .where('projectId').equals(taskId)
      .filter(img => img.type === 'result' && (img.shotIndex ?? 0) === shotIndex)
      .count();
    if (alreadyRecovered > 0) {
      await loadTaskData();
      return;
    }
    await handleStartGeneration([shotIndex], undefined, { runId, recoveryChecked: true });
  };

  // ─── 取消生成 ───
  const cancelGeneration = () => {
    abortControllerRef.current?.abort();
  };

  // --- 调整参数并重新生成 ---
  // customPromptOverride：AI 聊天触发整任务重做时附带的额外要求
  const handleRegenerateWithNewParams = async (customPromptOverride?: string) => {
    if (!project || generating || startLockRef.current || regenParamsLockRef.current) return;
    // 同步锁：备份旧结果是多步异步操作，双触发会把备份图错乱地再次备份/删除
    regenParamsLockRef.current = true;
    const runId = crypto.randomUUID();

    try {
      const gate = recoveryGate(await recoverPendingImages(taskId));
      if (!gate.proceed) {
        setErrorMessage(gate.message);
        return;
      }
      setShowAdjustPanel(false);
      setErrorMessage(null);
      // 不在此处 setGenerating(true) — handleStartGeneration 内部会管理

      // 1. 旧结果转为 result_backup（不再物理删除）
      //    若失败/取消，finally 会自动把 backup 还原为 result
      //    若成功，用户可手动选择 "保留新版" / "还原旧版"
      const oldResults = await db.images
        .where('projectId').equals(taskId)
        .filter(img => img.type === 'result')
        .toArray();
      // 先清掉已有的 backup（避免堆积），再标记新 backup
      const oldBackups = await db.images
        .where('projectId').equals(taskId)
        .filter(img => img.type === 'result_backup')
        .toArray();
      for (const b of oldBackups) {
        await db.images.delete(b.id!);
      }
      for (const r of oldResults) {
        await db.images.update(r.id!, { type: 'result_backup' });
      }
      // 「调整参数重新生成」意味着要换新的模特/体型/肤色 → 必须删掉旧的身份锚(肖像卡)。
      // 否则 handleStartGeneration 会复用旧锚并作为 sceneGroupAnchor 传给服务端,服务端见有锚
      // 就跳过"按新参数重画肖像卡",导致新选的模特/肤色对人物身份完全不生效(却仍逐张扣费)。
      // 注意:单张重做/补齐走 handleRegenerate,不经过这里,身份锚照常复用以保持同一新人。
      const staleAnchors = await db.images
        .where('projectId').equals(taskId)
        .filter(img => img.type === 'anchor')
        .toArray();
      for (const a of staleAnchors) {
        await db.images.delete(a.id!);
      }
      setImages([]);

      // 2. 如果上了新的风格/场景图，按 moduleType 只更新对应类型，不误删另一种
      if (newStyleImages.length > 0) {
        const imgType = project.moduleType === 'scene' ? 'scene_ref' : 'bg_ref';
        await db.images.where('projectId').equals(taskId)
          .filter(img => img.type === imgType)
          .delete();
        for (const img of newStyleImages) {
          await db.images.add({ projectId: taskId, type: imgType, data: img.base64, mimeType: img.mimeType });
        }
      }

      // 3. 更新 Project 参数
      const followSceneLocksModelParams =
        project.moduleType === 'scene' && !!project.sceneGroup && getModelIdentityMode(project) === 'follow_scene';
      const projectPatch: Partial<Project> = {
        engine: newEngine,
        generationQuality: normalizeGenerationQuality(newQuality),
        status: 'pending',
        updatedAt: new Date(),
      };
      if (!followSceneLocksModelParams) {
        projectPatch.modelId = newModelId || undefined;
        projectPatch.bodyType = newBodyType;
        projectPatch.skinTone = newSkinTone;
      }
      await db.projects.update(taskId, projectPatch);

      // 4. 重新加载 + 同步取得最新 project，直接传给 handleStartGeneration 避免 stale state
      const task = await db.projects.get(taskId);
      if (task) {
        setProject(task);
        await loadTaskData();
        // 用 await 而非 setTimeout（之前 100ms 是脆弱 race）
        await handleStartGeneration(undefined, customPromptOverride, { runId, recoveryChecked: true });
      }

    } catch (error) {
      console.error('重新生成失败:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(errorMsg);
      // 准备阶段就出错：把 backup 还原为 result，避免数据丢失
      try {
        const stuckBackups = await db.images
          .where('projectId').equals(taskId)
          .filter(i => i.type === 'result_backup')
          .toArray();
        for (const b of stuckBackups) {
          await db.images.update(b.id!, { type: 'result' });
        }
        await loadTaskData();
      } catch (e) {
        console.error('[backup 紧急还原] 失败:', e);
      }
      await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
      setProject(prev => prev ? { ...prev, status: 'failed' } : null);
    } finally {
      regenParamsLockRef.current = false;
      setNewStyleImages([]);
    }
  };

  const handleRegenerate = async (imageId: number, customPrompt?: string) => {
    // 也要挡住 startLock / abortController 窗口：否则 handleStartGeneration 会因这些锁提前 return，
    // 而旧图此前已被 update 成 result_backup —— 重做没发生、旧图却被永久降级，等于丢图。
    if (!project || generating || regenLockRef.current || startLockRef.current || abortControllerRef.current || regenConfirmingRef.current) return;
    // 单张重做同样按单价扣费：余额不足走充值弹窗；否则先确认金额，取消则什么都不跑（也不碰备份）。
    if (affordability(unitCostFen) === 'insufficient') {
      setRechargeNeedFen(unitCostFen);
      return;
    }
    regenConfirmingRef.current = true;
    let regenConfirmed = false;
    try {
      regenConfirmed = await confirm({
        title: '重新生成这张？',
        message: `将重新生成这 1 张，预计扣费 ${formatYuan(unitCostFen)}（生成失败自动退款）。当前这张会保留为备份，可在对比里还原。`,
        confirmText: `确认重做 · ${formatYuan(unitCostFen)}`,
      });
    } finally {
      regenConfirmingRef.current = false;
    }
    // 等待确认期间可能已有别的生成开跑，再核一次同步锁
    if (!regenConfirmed || generating || regenLockRef.current || startLockRef.current || abortControllerRef.current) return;
    regenLockRef.current = true;
    const runId = crypto.randomUUID();

    try {
      const gate = recoveryGate(await recoverPendingImages(taskId));
      if (!gate.proceed) {
        setErrorMessage(gate.message);
        return;
      }
      // 找到这张图，拿到它的 shotIndex（场景图无 shotIndex，按整任务重做）
      const img = images.find(i => i.id === imageId) || liveImages.find(i => i.id === imageId);
      if (!img) {
        console.warn('未找到要重做的图片:', imageId);
        return;
      }

      const moduleType = project.moduleType || 'product';
      const shotIndex = img.shotIndex;

      // 查找并删除已存在的备份图片（避免堆积）。
      // 注意：用 backupMatchesImage 严格匹配；同时跳过 imageId 自身，避免双击/竞态下把刚标记的 backup 误删。
      const backups = await db.images.where('projectId').equals(taskId).filter(i => i.type === 'result_backup').toArray();
      const existingBackup = backups.find(b => b.id !== imageId && backupMatchesImage(b, shotIndex));
      if (existingBackup) {
        await db.images.delete(existingBackup.id!);
      }

      // 将旧结果在数据库中标记为备份，暂不物理删除
      await db.images.update(imageId, { type: 'result_backup' });

      // 单张场景图（无 shotIndex）整张重做；产品图 & 场景组图按序号单张重做。
      // 注意：用 shotIndex === undefined 而非 !shotIndex，避免 shotIndex=0 被误判
      const isGroup = moduleType === 'scene' && !!project.sceneGroup;
      if (shotIndex === undefined || (moduleType === 'scene' && !isGroup)) {
        await handleStartGeneration(undefined, customPrompt, { runId, recoveryChecked: true });
      } else {
        // 产品镜次 或 组图参考图序号：只重做这一张
        await handleStartGeneration([shotIndex], customPrompt, { runId, recoveryChecked: true });
      }
    } catch (e) {
      console.error('重新生成失败:', e);
      setErrorMessage(e instanceof Error ? e.message : '重新生成失败');
    } finally {
      regenLockRef.current = false;
    }
  };

  const handleAcceptNewVersion = async (imageId: number) => {
    try {
      // 生成进行中新图只在 liveImages 里（images 还是旧列表），两个来源都要查，
      // 否则实时画廊上的"保留新版"按钮点击静默无效
      const img = images.find(i => i.id === imageId) || liveImages.find(i => i.id === imageId);
      if (!img) return;
      const backups = await db.images.where('projectId').equals(taskId).filter(i => i.type === 'result_backup').toArray();
      const backup = backups.find(b => backupMatchesImage(b, img.shotIndex));
      if (backup) {
        await db.images.delete(backup.id!);
      }
      setLiveImages(prev => prev.map(i => i.id === imageId ? { ...i, backup: undefined } : i));
      await loadTaskData();
    } catch (e) {
      console.error('保留新版失败:', e);
    }
  };

  const handleRejectNewVersion = async (imageId: number) => {
    try {
      const img = images.find(i => i.id === imageId) || liveImages.find(i => i.id === imageId);
      if (!img) return;
      // 先定位备份；找到才删除新图 + 恢复备份，避免"删完新图找不到备份 → 两版都丢"
      const backups = await db.images.where('projectId').equals(taskId).filter(i => i.type === 'result_backup').toArray();
      const backup = backups.find(b => backupMatchesImage(b, img.shotIndex));
      if (!backup) {
        console.warn('还原旧版：未找到匹配的备份，取消还原以避免数据丢失', { imageId, shotIndex: img.shotIndex });
        return;
      }
      await db.images.delete(imageId);
      await db.images.update(backup.id!, { type: 'result' });
      setLiveImages(prev => prev.filter(i => i.id !== imageId));
      await loadTaskData();
    } catch (e) {
      console.error('还原旧版失败:', e);
    }
  };


  // AI 聊天触发「整任务重做」：先把张数和费用讲清楚，用户确认才开跑。
  const handleAiTriggerGenerate = async () => {
    if (!project || generating || aiConfirmingRef.current || startLockRef.current || regenParamsLockRef.current) return;
    if (affordability(fullRunCostFen) === 'insufficient') {
      setRechargeNeedFen(fullRunCostFen);
      return;
    }
    const customPrompt = pendingChatPromptRef.current;
    aiConfirmingRef.current = true;
    let confirmed = false;
    try {
      confirmed = await confirm({
        title: 'AI 将重做整个任务',
        message: `将按当前设置重新生成全部 ${fullRunCount} 张，预计扣费 ${formatYuan(fullRunCostFen)}（失败的镜次自动退款）。${
          project.status === 'pending' ? '' : '已有的图会保留为备份，可在每张图上还原。'
        }`,
        confirmText: `确认重做 · ${formatYuan(fullRunCostFen)}`,
      });
    } finally {
      aiConfirmingRef.current = false;
    }
    // 等待确认期间用户可能已经手动开跑了别的生成，再核一次同步锁
    if (!confirmed || startLockRef.current || abortControllerRef.current) return;
    pendingChatPromptRef.current = '';
    if (project.status === 'pending') {
      // 待生成任务：直接开始（newBodyType/newSkinTone 等覆盖在 handleStartGeneration 里持久化）
      void handleStartGeneration(undefined, customPrompt || undefined);
    } else {
      // 已有结果的任务：走调整参数路径 —— 会先把旧结果转成备份再重做，
      // 否则新旧 result 在同 shotIndex 堆积、zip 下载同名互相覆盖；
      // 同时该路径会持久化 chat 设置的 newBodyType/newSkinTone
      void handleRegenerateWithNewParams(customPrompt || undefined);
    }
  };


  return {
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
  };
}
