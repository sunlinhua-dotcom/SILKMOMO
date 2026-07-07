'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, type Project, type ImageItem } from '@/lib/db';
import { ResultGallery } from '@/components/ResultGallery';
import { ModelSelector } from '@/components/ModelSelector';
import { EngineSelector, ENGINES, type ImageEngine } from '@/components/EngineSelector';
import { FailureHistoryPanel } from '@/components/FailureHistoryPanel';
import { ImageUploader } from '@/components/ImageUploader';
import { BodyTypeSelector } from '@/components/BodyTypeSelector';
import { SkinToneSelector } from '@/components/SkinToneSelector';
import {
  MODELS, BODY_TYPES, SKIN_TONES,
  PRODUCT_SHOTS, PRODUCT_OUTPUT_SIZES, SCENE_OUTPUT_SIZES,
  DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE,
  ETHNICITY_LABELS, SKU_LABELS,
} from '@/lib/models';
import { getRandomWaitingMessage } from '@/lib/api';
import { Clock, CheckCircle, XCircle, Loader, Wand2, Settings2, X, RefreshCcw, AlertTriangle, Ban } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { ImageLightbox } from '@/components/ImageLightbox';
import { AIChatSidebar } from '@/components/AIChatBox';
import Link from 'next/link';
import type { CompressedImage } from '@/lib/image-compressor';

// ═══ SSE 事件类型 ═══
type GenerationPhase = 'idle' | 'analyzing' | 'generating' | 'done' | 'error' | 'cancelled';
interface GenerationError { shotIndex: number; message: string; fatal: boolean; }
interface ProductGroupPayload {
  images: Array<{ data: string; mimeType: string }>;
  label?: string;
  categories?: string[];
}

// 备份-图片严格配对：两侧都 defined 且 shotIndex 相等，或两侧都 undefined（场景图）；
// 任一侧 undefined 而另一侧 defined → 不匹配（避免通配匹配到错误备份）。
function backupMatchesImage(b: ImageItem, imgShotIndex: number | undefined): boolean {
  if (b.shotIndex === undefined && imgShotIndex === undefined) return true;
  if (b.shotIndex === undefined || imgShotIndex === undefined) return false;
  return b.shotIndex === imgShotIndex;
}

function getSceneGroupMode(project: Project | null | undefined): 'swap' | 'products' {
  return project?.sceneGroupMode === 'products' ? 'products' : 'swap';
}

function buildProductGroupsFromImages(images: ImageItem[]): ProductGroupPayload[] {
  const grouped = new Map<number, ImageItem[]>();
  for (const img of images) {
    const groupIndex = typeof img.groupIndex === 'number' && img.groupIndex > 0 ? img.groupIndex : 1;
    grouped.set(groupIndex, [...(grouped.get(groupIndex) || []), img]);
  }
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, groupImages]) => {
      const label = groupImages.find(img => typeof img.prompt === 'string' && img.prompt.trim())?.prompt?.trim();
      return {
        label,
        images: groupImages.map(img => ({ data: img.data, mimeType: img.mimeType })),
      };
    });
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [inputImages, setInputImages] = useState<{
    products: ImageItem[];
    modelRefs: ImageItem[];
    bgRefs: ImageItem[];
    sceneRefs: ImageItem[];
    accessories: ImageItem[];
  }>({ products: [], modelRefs: [], bgRefs: [], sceneRefs: [], accessories: [] });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 1, shotIndex: 0 });
  const [waitingMessage, setWaitingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trialDone, setTrialDone] = useState(false);

  // ═══ SSE 实时状态 ═══
  const [generationPhase, setGenerationPhase] = useState<GenerationPhase>('idle');
  const [generationErrors, setGenerationErrors] = useState<GenerationError[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [liveImages, setLiveImages] = useState<ImageItem[]>([]); // 生成中实时追加的图片
  const abortControllerRef = useRef<AbortController | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 防止双击 重做 同一张图：第一次点击在 setGenerating(true) 之前还有窗口期，
  // 用 ref 立刻置位，第二次点击直接 return（避免备份图被自己刚生成的"备份"匹配并物理删除）
  const regenLockRef = useRef(false);
  // 主生成入口同样有窗口期：guard 检查后还有两次 IndexedDB await 才 setGenerating(true)，
  // 双击"全部生成/先试1张/重试"会并行跑两条 SSE 流 → 双倍扣费。同步 ref 锁先行置位。
  const startLockRef = useRef(false);
  // "调整参数重新生成"（含 AI 聊天整任务重做）的同步锁
  const regenParamsLockRef = useRef(false);

  // --- 调整参数面板 State ---
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newBodyType, setNewBodyType] = useState<'slim' | 'standard' | 'curvy'>(DEFAULT_BODY_TYPE.id);
  const [newSkinTone, setNewSkinTone] = useState<'light' | 'medium' | 'deep'>(DEFAULT_SKIN_TONE.id);
  const [newEngine, setNewEngine] = useState<ImageEngine>('gemini');
  const [newStyleImages, setNewStyleImages] = useState<CompressedImage[]>([]);

  // --- 输入图片放大预览 ---
  const [previewImage, setPreviewImage] = useState<{ src: string; label: string } | null>(null);

  // AI Chat 的"待应用 prompt"：actions.prompt 在 onActions 里捕获，onTriggerGenerate 时使用
  const pendingChatPromptRef = useRef<string>('');

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
        products: allImages.filter(img => img.type === 'product'),
        modelRefs: allImages.filter(img => img.type === 'model_ref'),
        bgRefs: allImages.filter(img => img.type === 'bg_ref'),
        sceneRefs: allImages.filter(img => img.type === 'scene_ref'),
        accessories: allImages.filter(img => img.type === 'accessory'),
      });
      // 同步当前参数到调整面板
      setNewModelId(task.modelId || '');
      setNewBodyType(task.bodyType || DEFAULT_BODY_TYPE.id);
      setNewSkinTone(task.skinTone || DEFAULT_SKIN_TONE.id);
      setNewEngine(task.engine === 'openai' ? 'openai' : 'gemini');
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
    const interval = setInterval(() => {
      setWaitingMessage(getRandomWaitingMessage());
    }, 4000);
    return () => clearInterval(interval);
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

  // 组件卸载时清理 SSE 连接和计时器，避免泄漏
  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const parseSelectedShots = (raw: string | undefined, fallback = [1, 2, 3, 4, 9]): number[] => {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every(n => Number.isInteger(n)) ? parsed : fallback;
    } catch {
      return fallback;
    }
  };

  const handleTrialGeneration = async () => {
    if (!project || generating || inputImages.products.length === 0) return;
    const moduleType = project.moduleType || 'product';
    if (moduleType !== 'product') return handleStartGeneration();
    const selectedShotIndexes = parseSelectedShots(project.selectedShots);
    // 显式标记试生成：不能用 overrideShotIndexes.length === 1 推断，
    // 否则单图重做成功也会误触发"试生成完成"横幅
    await handleStartGeneration([selectedShotIndexes[0]], undefined, { isTrial: true });
  };

  const handleGenerateRemaining = async () => {
    if (!project || generating || inputImages.products.length === 0) return;

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
      if (remaining.length === 0) return;
      await handleStartGeneration(remaining);
      return;
    }

    const selectedShotIndexes = parseSelectedShots(project.selectedShots);
    const remainingIndexes = selectedShotIndexes.filter(
      idx => !existingShotIndexes.includes(idx)
    );

    if (remainingIndexes.length === 0) return;
    await handleStartGeneration(remainingIndexes);
  };

  // ═══════════════════════════════════════════════════════════════
  // 核心：SSE 流式生成（全量 / 试生成 / 剩余 / 单图重做，统一入口）
  // overrideShotIndexes: 不传 = 用 project 里的配置；传 = 只生成指定镜次
  // customPrompt: 用户对该次生成的额外要求（追加到 prompt）
  // ═══════════════════════════════════════════════════════════════
  const handleStartGeneration = async (
    overrideShotIndexes?: number[],
    customPrompt?: string,
    opts?: { isTrial?: boolean }
  ) => {
    if (!project || inputImages.products.length === 0) return;
    // 防重复点击：generating 是异步 state，guard 后到 setGenerating(true) 之间
    // 还有多个 await（IndexedDB 读取）——双击会双双放行并行扣费。
    // startLockRef 同步置位封死这个窗口。
    if (generating || abortControllerRef.current || startLockRef.current) return;
    startLockRef.current = true;

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
      products: allImgs.filter(i => i.type === 'product'),
      modelRefs: allImgs.filter(i => i.type === 'model_ref'),
      bgRefs: allImgs.filter(i => i.type === 'bg_ref'),
      sceneRefs: allImgs.filter(i => i.type === 'scene_ref'),
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
    // 组图重做/补齐（指定了目标序号）时，取一张已有结果图作「新模特身份锚」，让补的图与首批同一个新人；
    // 全量生成（未指定 target）不带锚，由服务端首张成功图自锚。注意单张重做前该图已被降级为 result_backup，
    // 故按 type==='result' 过滤能自然排除正在重做的那张。
    let groupAnchor: { data: string; mimeType: string } | undefined;
    if (isGroup) {
      const savedAnchor = allImgs.find(i => i.type === 'anchor');
      if (savedAnchor) {
        groupAnchor = { data: savedAnchor.data, mimeType: savedAnchor.mimeType };
      }
    }
    if (isGroup && !groupAnchor && overrideShotIndexes && overrideShotIndexes.length > 0) {
      const doneSiblings = allImgs
        .filter(i => i.type === 'result' && typeof i.shotIndex === 'number' && !overrideShotIndexes.includes(i.shotIndex))
        .sort((a, b) => (a.shotIndex as number) - (b.shotIndex as number));
      if (doneSiblings.length > 0) {
        groupAnchor = { data: doneSiblings[0].data, mimeType: doneSiblings[0].mimeType };
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
    setGenerationErrors([]);
    setGenerationPhase('analyzing');
    setElapsedSeconds(0);

    // —— 初始化预估剩余时间(按引擎区分:GPT Image 2 实测 ~150-235s/张,Gemini ~20-35s/张;
    //     之前不分引擎统一按 15s/张 估算,GPT 会出现"预计剩余 17 秒"实跑 4 分钟的误导)——
    const etaFirstShotSec = newEngine === 'openai' ? 180 : 25;
    const etaPerShotSec = newEngine === 'openai' ? 180 : 15;
    const groupEtaCount = Math.max(1, groupTotal);
    const initialSeconds = moduleType === 'scene'
      ? (isGroup
          ? etaFirstShotSec + (groupEtaCount - 1) * etaPerShotSec
          : etaFirstShotSec)
      : (selectedShotIndexes.length === 1
          ? etaFirstShotSec
          : etaFirstShotSec + (selectedShotIndexes.length - 1) * etaPerShotSec);
    setSecondsLeft(initialSeconds);

    setLiveImages([]);
    setTrialDone(false);

    // —— 计时器 ——
    const timerStart = Date.now();
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - timerStart) / 1000));
      setSecondsLeft(prev => Math.max(0, prev - 1));
    }, 1000);

    // —— AbortController（取消用）——
    const ac = new AbortController();
    abortControllerRef.current = ac;

    // catch/finally 也要能读到，所以放 try 外
    let successCount = 0;
    let lastFatalError: string | null = null;
    let wasCancelled = false;

    try {
      // —— 用户在 pending 状态用快选 / AI 聊天改了模特/引擎/体型/肤色：持久化覆盖 ——
      const effectiveModelId = newModelId || freshProject.modelId || '';
      const effectiveEngine: 'gemini' | 'openai' = newEngine;
      const effectiveBodyType = newBodyType || freshProject.bodyType || DEFAULT_BODY_TYPE.id;
      const effectiveSkinTone = newSkinTone || freshProject.skinTone || DEFAULT_SKIN_TONE.id;
      const modelChanged = effectiveModelId !== (freshProject.modelId || '');
      const engineChanged = effectiveEngine !== (freshProject.engine || 'gemini');
      const bodyTypeChanged = effectiveBodyType !== (freshProject.bodyType || DEFAULT_BODY_TYPE.id);
      const skinToneChanged = effectiveSkinTone !== (freshProject.skinTone || DEFAULT_SKIN_TONE.id);
      if (modelChanged || engineChanged || bodyTypeChanged || skinToneChanged) {
        await db.projects.update(taskId, {
          modelId: effectiveModelId || undefined,
          engine: effectiveEngine,
          bodyType: effectiveBodyType,
          skinTone: effectiveSkinTone,
          updatedAt: new Date(),
        });
        setProject(prev => prev ? {
          ...prev,
          modelId: effectiveModelId || undefined,
          engine: effectiveEngine,
          bodyType: effectiveBodyType,
          skinTone: effectiveSkinTone,
        } : null);
      }

      await db.projects.update(taskId, { status: 'processing', lastError: undefined });
      setProject(prev => prev ? { ...prev, status: 'processing', lastError: undefined } : null);

      const productImgs = freshInputs.products.map(img => ({ data: img.data, mimeType: img.mimeType }));

      // ── 分块生成 ──
      // GPT(openai)每张 ~3 分钟,多张串在一个 SSE 请求里会撞路由预算/网关连接时长上限。
      // 产品图与 sceneGroup + openai 都切成每块 ≤3 张的连续请求；Gemini 仍单请求。
      const CHUNK_SIZE = 3;
      const targetIndexesForChunking = isGroup ? (groupTargetIndexes || []) : selectedShotIndexes;
      const shouldChunk =
        effectiveEngine === 'openai' &&
        ((moduleType === 'product' && selectedShotIndexes.length > CHUNK_SIZE) ||
          (isGroup && targetIndexesForChunking.length > CHUNK_SIZE));
      const genChunks: number[][] =
        shouldChunk
          ? Array.from({ length: Math.ceil(targetIndexesForChunking.length / CHUNK_SIZE) },
              (_, i) => targetIndexesForChunking.slice(i * CHUNK_SIZE, i * CHUNK_SIZE + CHUNK_SIZE))
          : [targetIndexesForChunking];
      let anchorForChunk: { data: string; mimeType: string } | undefined;
      let groupAnchorForChunk: { data: string; mimeType: string } | undefined = groupAnchor;
      const grandTotal = isGroup ? targetIndexesForChunking.length : (moduleType === 'product' ? selectedShotIndexes.length : 1);
      let doneSoFar = 0; // 已完成(成功或失败)的镜次数,用于跨块累计进度显示
      let fatalStop = false; // 某块出现 fatal(余额不足/扣费失败)→ 不再向后续块发请求

      for (let chunkIdx = 0; chunkIdx < genChunks.length; chunkIdx++) {
      const chunkShots = genChunks[chunkIdx];
      // 恰好在两块之间取消:此时没有在途 fetch 会抛 AbortError,必须在这里标记为取消,
      // 否则会掉进"统一定稿"分支显示"已完成"。fatal 则直接停止后续块。
      if (ac.signal.aborted) { wasCancelled = true; setGenerationPhase('cancelled'); break; }
      if (fatalStop) break;

      const response = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          taskId,
          moduleType,
          productImages: sceneGroupMode === 'products' ? [] : productImgs,
          productGroups: sceneGroupMode === 'products' ? productGroups : undefined,
          modelRefImages: freshInputs.modelRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          bgRefImages: freshInputs.bgRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          sceneRefImages: freshInputs.sceneRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          accessoryImages: freshInputs.accessories.map(img => ({ data: img.data, mimeType: img.mimeType })),
          modelId: effectiveModelId || undefined,
          bodyType: effectiveBodyType,
          skinTone: effectiveSkinTone,
          engine: effectiveEngine,
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
          sceneGroupTargetIndexes: isGroup ? chunkShots : undefined,
          sceneGroupAnchor: isGroup ? groupAnchorForChunk : undefined,
          sceneGroupGarmentCategories: isGroup ? groupGarmentCategories : undefined,
          customPrompt: effectiveCustomPrompt || undefined,
        }),
      });

      if (response.status === 401) {
        throw new Error('登录已过期，请重新登录后再试');
      }
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
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

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const eventType = currentEventType; // 捕获当前事件类型
            currentEventType = ''; // 消费后重置，防止下一个 data 行误匹配
            let payload: Record<string, unknown>;
            try { payload = JSON.parse(line.slice(6)); } catch { continue; }

            console.log(`[SSE] 事件: ${eventType}`, eventType === 'result' ? '(有图片数据)' : payload);

            if (eventType === 'status') {
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
              const imageData = payload.imageData as string | undefined;
              if (isGroup && imageData) {
                groupAnchorForChunk = { data: imageData, mimeType: 'image/png' };
                try {
                  const existingAnchor = await db.images.where('projectId').equals(taskId).filter(i => i.type === 'anchor').first();
                  if (existingAnchor?.id) {
                    await db.images.update(existingAnchor.id, { data: imageData, mimeType: 'image/png' });
                  } else {
                    await db.images.add({ projectId: taskId, type: 'anchor', data: imageData, mimeType: 'image/png' });
                  }
                } catch (e) {
                  console.error('[anchor 落库] 失败:', e);
                }
              }

            } else if (eventType === 'result') {
              const shotIndex = payload.shotIndex as number;
              const imageData = payload.imageData as string;
              const currentN = payload.current as number;
              successCount++;
              console.log(`[SSE] 图片 #${shotIndex} 大小: ${imageData?.length ?? 0} chars, success: ${successCount}`);
              // 跨块累计进度(用 grandTotal 作分母,doneSoFar 作偏移)
              const overallCurrent = doneSoFar + currentN;
              setProgress({ current: overallCurrent, total: grandTotal, shotIndex });

              // 动态修正预估剩余时间：整组剩余数量 × 单张预估（按引擎）
              const remaining = Math.max(0, grandTotal - overallCurrent);
              setSecondsLeft(remaining * etaPerShotSec);

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
              setGenerationErrors(prev => [...prev, errPayload]);
              if (payload.fatal) {
                const msg = payload.message as string;
                setErrorMessage(msg);
                lastFatalError = msg;
                fatalStop = true; // fatal(余额不足/扣费失败)→ 循环外的 guard 会停掉后续块,避免多发请求
              } else {
                // 非 fatal 也记录最后一条 SSE 错误（成功生成 0 张时作为兜底原因）
                lastFatalError = payload.message as string;
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
          if (a) anchorForChunk = { data: a.data, mimeType: 'image/png' };
        } catch { /* 抓不到 anchor 不阻塞,后续块会各自锚定 */ }
      }
      if (isGroup && !groupAnchorForChunk) {
        try {
          const savedAnchor = await db.images.where('projectId').equals(taskId).filter(i => i.type === 'anchor').first();
          if (savedAnchor) {
            groupAnchorForChunk = { data: savedAnchor.data, mimeType: savedAnchor.mimeType };
          } else {
            const a = await db.images.where('projectId').equals(taskId)
              .filter(i => i.type === 'result' && i.hasModel === true).first();
            if (a) groupAnchorForChunk = { data: a.data, mimeType: 'image/png' };
          }
        } catch { /* 抓不到 anchor 不阻塞，服务端会回退首张成功图 */ }
      }
      } // ← 关闭分块 for 循环

      // 全部分块跑完,统一定稿(不在每块 done 里定稿,否则多块状态会被后一块覆盖)。
      // 若在块间被取消(wasCancelled),不在这里定稿——交给 finally 的取消分支按实际产出回写。
      if (!wasCancelled) {
        const finalStatus = successCount > 0 ? 'completed' : 'failed';
        // 失败时持久化失败原因;部分成功(如中途余额不足)也持久化提示,
        // 否则任务显示"已完成"而 fatal 信息在 UI 任何地方看不到
        const persistedError = finalStatus === 'failed'
          ? (lastFatalError || '生成失败（未捕获具体原因）')
          : (lastFatalError ?? undefined);
        await db.projects.update(taskId, { status: finalStatus, lastError: persistedError, updatedAt: new Date() });
        setProject(prev => prev ? { ...prev, status: finalStatus, lastError: persistedError } : null);
        setGenerationPhase(successCount > 0 ? 'done' : 'error');
        setSecondsLeft(0);
        // 只有显式标记的试生成且恰好出 1 张才触发"试生成完成"横幅(单图重做/多张不算)
        if (opts?.isTrial && successCount === 1) {
          setTrialDone(true);
        }
      }

    } catch (err) {
      console.error('[生图前端] catch 错误:', err);
      if ((err as Error).name === 'AbortError') {
        // 用户主动取消 ≠ 失败：不能把任务标成 failed + "生成失败（catch）"。
        // 最终状态在 finally 的备份还原之后按实际产出决定（见 wasCancelled 分支）。
        wasCancelled = true;
        setGenerationPhase('cancelled');
        setErrorMessage(successCount > 0 ? `已取消生成（保留已生成的 ${successCount} 张）` : '已取消生成');
      } else {
        // 已成功生成的图保留：项目状态由实际产出决定
        const finalStatus = successCount > 0 ? 'completed' : 'failed';
        const msg = err instanceof Error ? `${err.message} (${err.name})` : '未知错误';
        console.error('[生图前端] 错误详情:', msg);
        setErrorMessage(msg);
        lastFatalError = msg;
        setGenerationPhase('error');
        const persistedError = finalStatus === 'failed' ? (lastFatalError || '生成失败（catch）') : undefined;
        await db.projects.update(taskId, { status: finalStatus, lastError: persistedError, updatedAt: new Date() });
        setProject(prev => prev ? { ...prev, status: finalStatus, lastError: persistedError } : null);
      }
    } finally {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      setSecondsLeft(0);
      setGenerating(false);
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
      }

      // 刷新最终图片列表
      await loadTaskData();
      startLockRef.current = false;
    }
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

    setShowAdjustPanel(false);
    setErrorMessage(null);
    // 不在此处 setGenerating(true) — handleStartGeneration 内部会管理

    try {
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
      await db.projects.update(taskId, {
        modelId: newModelId || undefined,
        bodyType: newBodyType,
        skinTone: newSkinTone,
        engine: newEngine,
        status: 'pending',
        updatedAt: new Date(),
      });

      // 4. 重新加载 + 同步取得最新 project，直接传给 handleStartGeneration 避免 stale state
      const task = await db.projects.get(taskId);
      if (task) {
        setProject(task);
        await loadTaskData();
        // 用 await 而非 setTimeout（之前 100ms 是脆弱 race）
        await handleStartGeneration(undefined, customPromptOverride);
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
    if (!project || generating || regenLockRef.current || startLockRef.current || abortControllerRef.current) return;
    regenLockRef.current = true;

    try {
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
        await handleStartGeneration(undefined, customPrompt);
      } else {
        // 产品镜次 或 组图参考图序号：只重做这一张
        await handleStartGeneration([shotIndex], customPrompt);
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

  const currentModel = project?.modelId ? MODELS.find(m => m.id === project.modelId) : undefined;
  const currentModelName = currentModel?.name ?? '未选择预设模特';
  const currentBodyTypeName = BODY_TYPES.find(b => b.id === project?.bodyType)?.name || DEFAULT_BODY_TYPE.name;
  const currentSkinToneName = SKIN_TONES.find(s => s.id === project?.skinTone)?.name || DEFAULT_SKIN_TONE.name;
  const currentEthnicityLabel = currentModel ? ETHNICITY_LABELS[currentModel.ethnicity] : null;
  const currentSkuLabel = project?.skuType ? SKU_LABELS[project.skuType] : null;

  const currentShotCount = (() => {
    if (!project?.selectedShots) return null;
    try { return JSON.parse(project.selectedShots).length as number; } catch { return null; }
  })();

  const currentOutputSizeLabel = (() => {
    if (!project) return null;
    const moduleT = project.moduleType || 'product';
    const sizeId = moduleT === 'scene' ? project.sceneOutputSize : project.outputSize;
    if (!sizeId) return null;
    const sizes = moduleT === 'scene' ? SCENE_OUTPUT_SIZES : PRODUCT_OUTPUT_SIZES;
    const size = sizes.find(s => s.id === sizeId);
    if (!size) return null;
    if (size.id === 'custom') {
      // 显示用户实际输入的宽高（'custom' 条目里的 aspectRatio 只是 3:4 占位）
      return project.customWidth && project.customHeight
        ? `自定义 ${project.customWidth}×${project.customHeight}`
        : '自定义尺寸';
    }
    return `${size.label} ${size.aspectRatio}`;
  })();

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

  const getShotCount = () => {
    if (!project) return 7;
    // 组图：目标张数 = lookbook 参考图张数
    if (project.moduleType === 'scene' && project.sceneGroup) {
      return getSceneGroupMode(project) === 'products'
        ? buildProductGroupsFromImages(inputImages.products).length
        : inputImages.sceneRefs.length;
    }
    return parseSelectedShots(project.selectedShots).length;
  };

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

  // 进度条宽度：
  // - analyzing：固定 8% 起步
  // - 收尾窗口（图都到齐、等 done 事件）：100%
  // - 生成中：取「已完成镜次占比」与「按已耗时/预计时间的估算占比」的较大值。
  //   单张长任务（GPT 一张 ~2-3 分钟）上游不返回中途进度，靠 timeFrac 让进度条
  //   随秒表匀速往前爬，不至于卡在起点显得僵住；估算值封顶 95%，真正出图/收尾才到 100%。
  const progressBarWidth = (() => {
    if (generationPhase === 'analyzing') return '8%';
    if (isFinishingUp) return '100%';
    const shotFrac = liveImages.length / Math.max(progress.total, 1);
    const denom = elapsedSeconds + secondsLeft;
    const timeFrac = denom > 0 ? elapsedSeconds / denom : 0;
    const frac = Math.min(0.95, Math.max(shotFrac, timeFrac));
    return `${Math.max(8, frac * 100)}%`;
  })();

  const currentEngineId: ImageEngine = project.engine === 'openai' ? 'openai' : 'gemini';
  const currentEngineName = ENGINES.find(e => e.id === currentEngineId)?.name ?? 'Gemini Flash Image';

  const paramChips = (
    <div className="flex flex-wrap gap-2">
      <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
        引擎: {currentEngineName}
      </span>
      {project.modelId && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          模特: {currentModelName}{currentEthnicityLabel ? ` · ${currentEthnicityLabel}` : ''}
        </span>
      )}
      <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
        体型: {currentBodyTypeName}
      </span>
      <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
        肤色: {currentSkinToneName}
      </span>
      {moduleType === 'product' && currentSkuLabel && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          SKU: {currentSkuLabel}
        </span>
      )}
      {moduleType === 'product' && currentShotCount !== null && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          镜次: {currentShotCount} 张
        </span>
      )}
      {moduleType === 'scene' && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          场景: {project.sceneHasModel === false ? '氛围静物' : '有模特'}
        </span>
      )}
      {currentOutputSizeLabel && (
        <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
          尺寸: {currentOutputSizeLabel}
        </span>
      )}
    </div>
  );

  // 任务页面的 AI Chat：当用户描述调整时，触发对当前任务的 customPrompt 重做
  const taskChatContext = `当前任务: ${project.name}, 模块: ${moduleType === 'product' ? '产品图' : '场景图'}, 体型: ${currentBodyTypeName}, 肤色: ${currentSkinToneName}, 已生成: ${images.length}张`;

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* 任务侧的 AI Chat 侧边栏：用户可以描述要调整什么，AI 提取参数后整任务重做 */}
      <AIChatSidebar
        context={taskChatContext}
        emptyStateHint={`💬 描述要调整什么\n例如："模特表情更柔和"、"整体亮度提高"\n\nAI 会用你的描述重做这个任务的所有图片`}
        placeholder="描述要调整什么..."
        onActions={(actions) => {
          // 单图细节调整建议在结果图上 hover → ✨ 按钮
          // 这里的 chat 走整任务重做流程
          if (actions.bodyType && actions.bodyType !== project.bodyType) {
            setNewBodyType(actions.bodyType);
          }
          if (actions.skinTone && actions.skinTone !== project.skinTone) {
            setNewSkinTone(actions.skinTone);
          }
          // 捕获 prompt，下一步 onTriggerGenerate 时附加到生成请求
          if (actions.prompt) {
            pendingChatPromptRef.current = actions.prompt;
          }
        }}
        onTriggerGenerate={() => {
          if (generating) return;
          const customPrompt = pendingChatPromptRef.current;
          pendingChatPromptRef.current = '';
          if (project.status === 'pending') {
            // 待生成任务：直接开始（newBodyType/newSkinTone 等覆盖在 handleStartGeneration 里持久化）
            handleStartGeneration(undefined, customPrompt || undefined);
          } else {
            // 已有结果的任务：走调整参数路径 —— 会先把旧结果转成备份再重做，
            // 否则新旧 result 在同 shotIndex 堆积、zip 下载同名互相覆盖；
            // 同时该路径会持久化 chat 设置的 newBodyType/newSkinTone
            handleRegenerateWithNewParams(customPrompt || undefined);
          }
        }}
      />

      {/* 桌面端：主内容向右偏移以避让 AI 侧边栏（72 * 4 = 288px） */}
      <div className="lg:pl-72 transition-all duration-500">

      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 flex items-center justify-center transition-transform hover:scale-105">
                <Logo width={40} height={40} />
              </div>
              <span className="text-lg font-semibold tracking-tight">SILXINE</span>
            </Link>

            <div className="flex items-center gap-3">
              {/* 项目名称和状态 */}
              <h1 className="hidden sm:block text-base font-medium truncate max-w-[150px] text-[var(--color-text)]">
                {project.name}
              </h1>

              {/* 模块类型标签 */}
              <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-[var(--color-background)] text-[var(--color-text-secondary)]">
                {moduleType === 'product' ? '产品图' : '场景图'}
              </span>

              {project.status === 'pending' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-background)] rounded-full">
                  <Clock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
                  等待生成
                </span>
              )}
              {project.status === 'processing' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-accent)]/10 rounded-full text-[var(--color-accent)] tabular-nums">
                  <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  {liveImages.length}/{progress.total}
                </span>
              )}
              {project.status === 'completed' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-green-50 rounded-full text-green-600">
                  <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  已完成
                </span>
              )}
              {project.status === 'failed' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-red-50 rounded-full text-red-500">
                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  失败
                </span>
              )}

              {/* 调整参数按钮 */}
              {(project.status === 'completed' || project.status === 'failed') && !generating && (
                <button
                  onClick={() => setShowAdjustPanel(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-white rounded-xl hover:bg-[var(--color-accent-dark)] transition-colors"
                >
                  <Settings2 className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">调整参数</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 调整参数面板 (Modal) */}
      {showAdjustPanel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--color-surface)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl border border-[var(--color-border-light)]">
            {/* 头部 */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-light)]">
              <h2 className="text-lg font-semibold">调整参数，重新生成</h2>
              <button
                onClick={() => setShowAdjustPanel(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-background)] transition-colors"
                aria-label="关闭参数调整面板"
              >
                <X className="w-5 h-5 text-[var(--color-text-muted)]" aria-hidden="true" />
              </button>
            </div>

            {/* 内容 */}
            <div className="p-5 space-y-6">
              {/* 当前参数概览 */}
              <div className="text-sm text-[var(--color-text-secondary)] space-y-1">
                <div>当前模特: <span className="font-medium text-[var(--color-text)]">{currentModelName}</span></div>
                <div>当前体型: <span className="font-medium text-[var(--color-text)]">{currentBodyTypeName}</span></div>
                <div>当前肤色: <span className="font-medium text-[var(--color-text)]">{currentSkinToneName}</span></div>
              </div>

              {/* 生图引擎选择 */}
              <div>
                <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">生图引擎</h3>
                <EngineSelector
                  selected={newEngine}
                  onSelect={setNewEngine}
                  variant="full"
                />
              </div>

              {/* 模特选择 */}
              <div>
                <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">选择模特</h3>
                <ModelSelector
                  selectedModel={newModelId}
                  onSelect={setNewModelId}
                />
              </div>

              {/* 体型选择（三选） */}
              <div>
                <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">体型选择</h3>
                <BodyTypeSelector
                  selectedBodyType={newBodyType}
                  onSelect={setNewBodyType}
                />
              </div>

              {/* 肤色选择（三选）— 新增 */}
              <div>
                <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">肤色选择</h3>
                <SkinToneSelector
                  selectedSkinTone={newSkinTone}
                  onSelect={setNewSkinTone}
                />
              </div>

              {/* 风格参考上传 */}
              <div>
                <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
                  更换{moduleType === 'scene' ? '场景' : '背景'}参考 <span className="text-[var(--color-text-muted)]">(可选)</span>
                </h3>
                <ImageUploader
                  title=""
                  description={moduleType === 'scene'
                    ? '上传新的场景参考图，将覆盖原有设置'
                    : '上传新的背景参考图，将覆盖原有设置'
                  }
                  maxFiles={5}
                  images={newStyleImages}
                  onImagesChange={setNewStyleImages}
                  variant="gray"
                />
              </div>
            </div>

            {/* 底部 */}
            <div className="p-5 border-t border-[var(--color-border-light)]">
              <button
                onClick={() => handleRegenerateWithNewParams()}
                className="btn-primary w-full"
              >
                <RefreshCcw className="w-5 h-5" />
                开始重新生成
              </button>
              <p className="text-xs text-[var(--color-text-muted)] mt-3 text-center">
                将使用原有的产品图，配合新的模特/体型/肤色参数重新生成
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* ═══ 生成中状态（SSE 实时） ═══ */}
        {generating && (
          <div className="mb-8">
            {/* 主进度卡 */}
            <div className="mb-4 text-center py-10 px-6 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center shadow-lg">
                {generationPhase === 'analyzing'
                  ? <Loader className="w-8 h-8 text-white animate-spin" strokeWidth={1.5} />
                  : <Wand2 className="w-8 h-8 text-white animate-pulse" strokeWidth={1.5} />
                }
              </div>

              <h2 className="text-xl font-semibold mb-1">{phaseTitle}</h2>

              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                {generationPhase === 'analyzing'
                  ? '这将帮助 AI 更精准地还原面料细节'
                  : waitingMessage
                }
              </p>

              <div className="max-w-sm mx-auto">
                <div className="h-2 bg-[var(--color-background)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-light)] transition-all duration-700 rounded-full"
                    style={{ width: progressBarWidth }}
                  />
                </div>
                <div className="flex justify-between items-center mt-2">
                  <p className="text-xs text-[var(--color-text-muted)]">{phaseSubLabel}</p>
                  <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-2">
                    <span>已耗时 {elapsedSeconds}s</span>
                    {secondsLeft > 0 && <span className="text-[var(--color-accent)] font-medium">预计剩余时间：{secondsLeft} 秒</span>}
                    {elapsedSeconds > (currentEngineId === 'openai' ? 300 : 90) && <span className="text-amber-500 ml-1">（响应较慢，请稍候）</span>}
                  </p>
                </div>
              </div>

              {moduleType === 'product' && liveImages.length >= 1 && progress.total > 1 && (
                <div className="mt-6 max-w-sm mx-auto p-3.5 rounded-2xl bg-gradient-to-r from-[var(--color-accent)]/10 to-[var(--color-accent-light)]/5 border border-[var(--color-accent)]/20 text-[var(--color-accent)] text-xs text-center animate-fade-in shadow-sm flex items-center justify-center gap-2">
                  <span>✨ 模特身份已成功锚定！正在以此模特渲染剩余的镜次…</span>
                </div>
              )}

              {/* 取消按钮 */}
              <button
                onClick={cancelGeneration}
                className="mt-6 flex items-center gap-1.5 mx-auto text-xs text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
              >
                <Ban className="w-3.5 h-3.5" />
                取消生成
              </button>
            </div>

            {/* 实时已生成图片追加区 */}
            {liveImages.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-medium text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  已完成 {liveImages.length} 张（生成中实时追加）
                </h3>
                <ResultGallery
                  images={liveImages.map(img => ({
                    id: img.id!,
                    type: img.imageType || 'close_up',
                    imageType: img.imageType || 'close_up',
                    data: img.data,
                    prompt: img.prompt,
                    index: img.index,
                    backup: img.backup,
                  }))}
                  onRegenerate={handleRegenerate}
                  onAcceptNewVersion={handleAcceptNewVersion}
                  onRejectNewVersion={handleRejectNewVersion}
                />
              </div>
            )}

            {/* 错误汇总（非 fatal，生成仍在继续）。这里只做信息展示——同一条 SSE 流还在跑，
                无法中途单独重试某一张；失败镜次的单张重试在生成结束后用「补生成剩余」或失败态的
                「重试这张」完成。 */}
            {generationErrors.filter(e => !e.fatal).length > 0 && (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <p className="text-sm font-medium text-amber-700">部分镜次生成失败（生成继续，稍后可补生成）</p>
                </div>
                {generationErrors.filter(e => !e.fatal).map((e, i) => (
                  <p key={i} className="text-xs text-amber-600 font-mono mt-1 break-all">
                    镜次 #{e.shotIndex}: {e.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 输入图片概览 */}
        <div className="mb-10 bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            输入图片
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {inputImages.products.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewImage({ src: `data:${img.mimeType};base64,${img.data}`, label: '产品' })}
                  className="w-20 h-20 rounded-xl overflow-hidden border-2 border-[var(--color-accent)] shadow-sm cursor-zoom-in hover:scale-105 transition-transform block"
                  title="点击放大"
                >
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="产品"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </button>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">产品</p>
              </div>
            ))}
            {inputImages.modelRefs.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewImage({ src: `data:${img.mimeType};base64,${img.data}`, label: '模特参考' })}
                  className="w-20 h-20 rounded-xl overflow-hidden border border-purple-300 shadow-sm cursor-zoom-in hover:scale-105 transition-transform block"
                  title="点击放大"
                >
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="模特参考"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </button>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">模特参考</p>
              </div>
            ))}
            {inputImages.bgRefs.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewImage({ src: `data:${img.mimeType};base64,${img.data}`, label: '背景参考' })}
                  className="w-20 h-20 rounded-xl overflow-hidden border border-[var(--color-border)] opacity-80 cursor-zoom-in hover:scale-105 hover:opacity-100 transition-all block"
                  title="点击放大"
                >
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="背景参考"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </button>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">背景</p>
              </div>
            ))}
            {inputImages.sceneRefs.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewImage({ src: `data:${img.mimeType};base64,${img.data}`, label: '场景参考' })}
                  className="w-20 h-20 rounded-xl overflow-hidden border border-green-300 opacity-80 cursor-zoom-in hover:scale-105 hover:opacity-100 transition-all block"
                  title="点击放大"
                >
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="场景参考"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </button>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">场景</p>
              </div>
            ))}
            {inputImages.accessories.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewImage({ src: `data:${img.mimeType};base64,${img.data}`, label: '配件' })}
                  className="w-20 h-20 rounded-xl overflow-hidden border border-dashed border-[var(--color-border)] opacity-60 cursor-zoom-in hover:scale-105 hover:opacity-100 transition-all block"
                  title="点击放大"
                >
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="配件"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </button>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">配件</p>
              </div>
            ))}
          </div>

          <div className="mt-4">{paramChips}</div>
        </div>

        {/* 开始生成按钮 */}
        {project.status === 'pending' && !generating && (
          <div className="mb-12 text-center py-12 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#1a1a1a] flex items-center justify-center">
              <Wand2 className="w-8 h-8 text-[var(--color-accent)]" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold mb-3">
              {moduleType === 'product' ? '准备生成产品图组' : '准备生成场景图'}
            </h2>
            <p className="text-[var(--color-text-secondary)] mb-6 text-sm max-w-md mx-auto">
              {moduleType === 'product'
                ? `AI 将为您生成 ${getShotCount()} 张专业产品图`
                : 'AI 将根据场景参考图生成专业场景图'
              }
            </p>

            {/* 生成前最后一次微调：引擎 + 模特 */}
            <div className="mb-8 px-4 sm:px-8 text-left space-y-6">
              <EngineSelector
                selected={newEngine}
                onSelect={setNewEngine}
                variant="full"
              />
              <ModelSelector
                selectedModel={newModelId}
                onSelect={setNewModelId}
              />
            </div>

            {moduleType === 'product' && getShotCount() > 1 ? (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                {/* 推荐：先试 1 张 */}
                <button
                  onClick={handleTrialGeneration}
                  className="btn-primary"
                >
                  <Wand2 className="w-5 h-5" strokeWidth={1.5} />
                  <span>先试 1 张（推荐）</span>
                </button>
                {/* 全量生成 */}
                <button
                  onClick={() => handleStartGeneration()}
                  className="flex items-center gap-2 px-6 py-3 text-sm font-medium border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-background)] text-[var(--color-text-secondary)] transition-colors"
                >
                  {getGenerateLabel()}
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleStartGeneration()}
                className="btn-primary"
              >
                <Wand2 className="w-5 h-5" strokeWidth={1.5} />
                {getGenerateLabel()}
              </button>
            )}

            <p className="text-xs text-[var(--color-text-muted)] mt-4">
              {moduleType === 'product' && getShotCount() > 1
                ? `💡 先试 1 张确认效果（$0.045），满意后再生成剩余 ${getShotCount() - 1} 张`
                : '预计需要 1-2 分钟，请保持页面开启'
              }
            </p>
          </div>
        )}

        {/* 试生成完成 / 部分完成 → 生成剩余按钮。
            用持久化的 project.status==='completed' 作主条件(trialDone 是内存态、刷新即丢,
            否则 reload 一个"已完成但只出了部分镜次"的任务后,所有"继续生成剩余"入口全消失,
            只剩会把已生成图降级重做的「调整参数」)。trialDone 作同会话兜底。 */}
        {!generating && moduleType === 'product' && (project.status === 'completed' || trialDone)
          && images.length > 0 && images.length < getShotCount() && (
          <div className="mb-8 p-5 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-accent)]/30 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">✅ 试生成完成 — 效果满意吗？</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                满意就继续生成剩余 {getShotCount() - images.length} 张，不满意可以调整参数重试
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAdjustPanel(true)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-background)] text-[var(--color-text-secondary)] transition-colors"
              >
                <Settings2 className="w-4 h-4" />
                调整参数
              </button>
              <button
                onClick={handleGenerateRemaining}
                className="btn-primary text-sm px-5 py-2.5"
              >
                <Wand2 className="w-4 h-4" strokeWidth={1.5} />
                生成剩余 {getShotCount() - images.length} 张
              </button>
            </div>
          </div>
        )}

        {/* 组图·部分完成（如大批量分批 / 中途失败）→ 生成剩余。张数多时 GPT 单条 SSE 跑不完，靠此续跑补齐 */}
        {!generating && moduleType === 'scene' && project.sceneGroup && project.status === 'completed'
          && images.length > 0 && getShotCount() > 0 && images.length < getShotCount() && (
          <div className="mb-8 p-5 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-accent)]/30 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">已完成 {images.length} / {getShotCount()} 张组图</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                还差 {getShotCount() - images.length} 张（张数多时会分批完成）——点下方补齐剩余。
              </p>
            </div>
            <button
              onClick={handleGenerateRemaining}
              className="btn-primary text-sm px-5 py-2.5"
            >
              <Wand2 className="w-4 h-4" strokeWidth={1.5} />
              生成剩余 {getShotCount() - images.length} 张
            </button>
          </div>
        )}

        {/* 结果展示 */}
        {images.length > 0 && (
          <div ref={resultsRef}>
            {/* 部分成功提示：任务"已完成"但中途有镜次失败 / 余额不足。
                不渲染的话余额不足等 fatal 信息在已完成任务上完全不可见 */}
            {!generating && project.status === 'completed' && errorMessage && (
              <div className="mb-5 p-4 bg-amber-50 rounded-2xl border border-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  {/* 仅展示错误信息;"生成剩余"入口已由上方持久化条件的面板统一提供,此处不再重复按钮 */}
                  <p className="text-sm text-amber-700 break-all flex-1">{errorMessage}</p>
                </div>
              </div>
            )}
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              生成结果 · {images.length} 张
            </h2>

            <div className="mb-6">{paramChips}</div>

            {productGroupLabels.length > 0 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {productGroupLabels.map((label, index) => (
                  <span
                    key={`${label}-${index}`}
                    className="text-xs px-2.5 py-1 rounded-lg bg-[var(--color-background)] text-[var(--color-text-secondary)]"
                  >
                    产品 {index + 1}: {label || `产品 ${index + 1}`}
                  </span>
                ))}
              </div>
            )}

            <ResultGallery
              images={images.map(img => ({
                id: img.id!,
                type: img.imageType || 'close_up',
                imageType: img.imageType || 'close_up',
                data: img.data,
                prompt: img.prompt,
                index: img.index,
                backup: img.backup,
              }))}
              onRegenerate={handleRegenerate}
              onAcceptNewVersion={handleAcceptNewVersion}
              onRejectNewVersion={handleRejectNewVersion}
            />
          </div>
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
          <div className="text-center py-16 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">生成失败</h2>

            {/* 优先展示具体错误信息 */}
            {errorMessage ? (
              <div className="max-w-lg mx-auto mb-6">
                <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700 text-left break-all">{errorMessage}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[var(--color-text-secondary)] mb-4 text-sm max-w-md mx-auto">
                请检查网络连接或稍后重试
              </p>
            )}

            {/* SSE 过程中的详细错误列表 — 产品镜次可单张重试 */}
            {generationErrors.length > 0 && (
              <div className="max-w-lg mx-auto mb-6">
                <div className="p-4 bg-[var(--color-background)] rounded-2xl text-left">
                  <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">错误详情</p>
                  {generationErrors.map((e, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 mt-1.5">
                      <p className="text-xs text-red-600 font-mono break-all">
                        {e.shotIndex >= 0 ? `镜次 #${e.shotIndex}: ` : ''}{e.message}
                      </p>
                      {e.shotIndex > 0 && (
                        <button
                          onClick={() => handleStartGeneration([e.shotIndex])}
                          disabled={generating}
                          className="shrink-0 text-xs px-3 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] disabled:opacity-40 transition-colors"
                        >
                          重试这张
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 服务端历史尝试（来自 Postgres GenerationRecord）*/}
            <FailureHistoryPanel taskId={taskId} />

            <button
              onClick={() => handleStartGeneration()}
              className="btn-primary"
            >
              重试
            </button>
          </div>
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
