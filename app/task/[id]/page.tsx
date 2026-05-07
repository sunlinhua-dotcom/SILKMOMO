'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, type Project, type ImageItem } from '@/lib/db';
import { ResultGallery } from '@/components/ResultGallery';
import { ModelSelector } from '@/components/ModelSelector';
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
  const [liveImages, setLiveImages] = useState<ImageItem[]>([]); // 生成中实时追加的图片
  const abortControllerRef = useRef<AbortController | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- 调整参数面板 State ---
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newBodyType, setNewBodyType] = useState<'slim' | 'standard' | 'curvy'>(DEFAULT_BODY_TYPE.id);
  const [newSkinTone, setNewSkinTone] = useState<'light' | 'medium' | 'deep'>(DEFAULT_SKIN_TONE.id);
  const [newStyleImages, setNewStyleImages] = useState<CompressedImage[]>([]);

  // --- 输入图片放大预览 ---
  const [previewImage, setPreviewImage] = useState<{ src: string; label: string } | null>(null);

  // AI Chat 的"待应用 prompt"：actions.prompt 在 onActions 里捕获，onTriggerGenerate 时使用
  const pendingChatPromptRef = useRef<string>('');

  const loadTaskData = useCallback(async () => {
    try {
      const task = await db.projects.get(taskId);
      if (!task) {
        router.push('/');
        return;
      }
      const allImages = await db.images.where('projectId').equals(taskId).toArray();

      setProject(task);
      setImages(allImages.filter(img => img.type === 'result'));
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
    await handleStartGeneration([selectedShotIndexes[0]]);
  };

  const handleGenerateRemaining = async () => {
    if (!project || generating || inputImages.products.length === 0) return;

    const selectedShotIndexes = parseSelectedShots(project.selectedShots);

    const existingResults = await db.images
      .where('projectId').equals(taskId)
      .filter(img => img.type === 'result')
      .toArray();
    const existingShotIndexes = existingResults
      .map(img => img.shotIndex)
      .filter(Boolean) as number[];
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
  const handleStartGeneration = async (overrideShotIndexes?: number[], customPrompt?: string) => {
    if (!project || inputImages.products.length === 0) return;
    // 防重复点击：已经在生成中就直接忽略
    if (generating || abortControllerRef.current) return;

    // —— 重置状态 ——
    setGenerating(true);
    setErrorMessage(null);
    setGenerationErrors([]);
    setGenerationPhase('analyzing');
    setElapsedSeconds(0);
    setLiveImages([]);
    setTrialDone(false);

    // —— 计时器 ——
    const timerStart = Date.now();
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - timerStart) / 1000));
    }, 1000);

    // —— AbortController（取消用）——
    const ac = new AbortController();
    abortControllerRef.current = ac;

    const moduleType = project.moduleType || 'product';
    const selectedShotIndexes = overrideShotIndexes ?? parseSelectedShots(project.selectedShots);

    // catch/finally 也要能读到，所以放 try 外
    let successCount = 0;

    try {
      // —— 用户在 pending 状态用快选改了模特：持久化覆盖 ——
      const effectiveModelId = newModelId || project.modelId || '';
      if (effectiveModelId !== (project.modelId || '')) {
        await db.projects.update(taskId, {
          modelId: effectiveModelId || undefined,
          updatedAt: new Date(),
        });
        setProject(prev => prev ? { ...prev, modelId: effectiveModelId || undefined } : null);
      }

      await db.projects.update(taskId, { status: 'processing' });
      setProject(prev => prev ? { ...prev, status: 'processing' } : null);

      const productImgs = inputImages.products.map(img => ({ data: img.data, mimeType: img.mimeType }));

      const response = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          taskId,
          moduleType,
          productImages: productImgs,
          modelRefImages: inputImages.modelRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          bgRefImages: inputImages.bgRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          sceneRefImages: inputImages.sceneRefs.map(img => ({ data: img.data, mimeType: img.mimeType })),
          accessoryImages: inputImages.accessories.map(img => ({ data: img.data, mimeType: img.mimeType })),
          modelId: effectiveModelId || undefined,
          bodyType: project.bodyType || DEFAULT_BODY_TYPE.id,
          skinTone: project.skinTone || DEFAULT_SKIN_TONE.id,
          selectedShotIndexes,
          outputSize: project.outputSize,
          sceneOutputSize: project.sceneOutputSize,
          customPrompt: customPrompt || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
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
              setGenerationPhase(phase === 'analyzing' ? 'analyzing' : 'generating');
              if (payload.current !== undefined) {
                setProgress({
                  current: (payload.current as number),
                  total: (payload.total as number),
                  shotIndex: (payload.shotIndex as number) ?? 0,
                });
              }

            } else if (eventType === 'result') {
              const shotIndex = payload.shotIndex as number;
              const imageData = payload.imageData as string;
              const currentN = payload.current as number;
              const total = payload.total as number;
              successCount++;
              console.log(`[SSE] 图片 #${shotIndex} 大小: ${imageData?.length ?? 0} chars, success: ${successCount}`);
              setProgress({ current: currentN, total, shotIndex });

              // 实时写入 IndexedDB + 追加到 liveImages
              const shotConfig = PRODUCT_SHOTS.find(s => s.index === shotIndex);
              const newImgId = await db.images.add({
                projectId: taskId,
                type: 'result',
                data: imageData,
                mimeType: 'image/png',
                shotIndex: shotIndex > 0 ? shotIndex : undefined,
                frameType: shotConfig?.frameType,
                shootingAngle: shotConfig?.angle,
                hasModel: shotConfig?.hasModel,
                imageType: shotConfig
                  ? (shotConfig.frameType === 'full_body' ? 'full_body'
                    : shotConfig.frameType === 'upper_body' ? 'half_body' : 'close_up')
                  : 'hero',
                index: shotIndex,
              });
              const newImg: ImageItem = {
                id: newImgId as number,
                projectId: taskId,
                type: 'result',
                data: imageData,
                mimeType: 'image/png',
                shotIndex: shotIndex > 0 ? shotIndex : undefined,
                imageType: shotConfig
                  ? (shotConfig.frameType === 'full_body' ? 'full_body'
                    : shotConfig.frameType === 'upper_body' ? 'half_body' : 'close_up')
                  : 'hero',
                index: shotIndex,
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
                setErrorMessage(payload.message as string);
              }

            } else if (eventType === 'done') {
              console.log(`[SSE] done 事件, successCount=${successCount}`);
              // 最终状态写入
              const finalStatus = successCount > 0 ? 'completed' : 'failed';
              await db.projects.update(taskId, { status: finalStatus, updatedAt: new Date() });
              setProject(prev => prev ? { ...prev, status: finalStatus } : null);
              setGenerationPhase(successCount > 0 ? 'done' : 'error');
              // 如果是试生成（只生成 1 张），标记 trialDone
              if (overrideShotIndexes?.length === 1 && successCount === 1) {
                setTrialDone(true);
              }
            }
          }
        }
      }

    } catch (err) {
      console.error('[生图前端] catch 错误:', err);
      // 已成功生成的图保留：项目状态由实际产出决定
      const finalStatus = successCount > 0 ? 'completed' : 'failed';
      if ((err as Error).name === 'AbortError') {
        setGenerationPhase('cancelled');
        setErrorMessage(successCount > 0 ? `已取消生成（保留已生成的 ${successCount} 张）` : '已取消生成');
      } else {
        const msg = err instanceof Error ? `${err.message} (${err.name})` : '未知错误';
        console.error('[生图前端] 错误详情:', msg);
        setErrorMessage(msg);
        setGenerationPhase('error');
      }
      await db.projects.update(taskId, { status: finalStatus, updatedAt: new Date() });
      setProject(prev => prev ? { ...prev, status: finalStatus } : null);
    } finally {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      setGenerating(false);
      abortControllerRef.current = null;
      // 刷新最终图片列表
      await loadTaskData();
    }
  };

  // ─── 取消生成 ───
  const cancelGeneration = () => {
    abortControllerRef.current?.abort();
  };

  // --- 调整参数并重新生成 ---
  const handleRegenerateWithNewParams = async () => {
    if (!project) return;

    setShowAdjustPanel(false);
    setGenerating(true);
    setErrorMessage(null);

    try {
      // 1. 清除旧结果
      await db.images.where('projectId').equals(taskId).filter(img => img.type === 'result').delete();
      setImages([]);

      // 2. 如果上了新的风格/场景图
      if (newStyleImages.length > 0) {
        const imgType = project.moduleType === 'scene' ? 'scene_ref' : 'bg_ref';
        await db.images.where('projectId').equals(taskId)
          .filter(img => img.type === 'scene_ref' || img.type === 'bg_ref')
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
        status: 'pending',
        updatedAt: new Date(),
      });

      // 4. 重新加载数据
      await loadTaskData();

      // 5. 触发生成（loadTaskData 完成后 project 已更新）
      // 因为 setState 异步，直接在这里重新读取并生成
      const task = await db.projects.get(taskId);
      if (task) {
        setProject(task);
        // 延迟一帧让 state 同步
        setTimeout(() => {
          handleStartGeneration();
        }, 100);
      }

    } catch (error) {
      console.error('重新生成失败:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(errorMsg);
      await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
      setProject(prev => prev ? { ...prev, status: 'failed' } : null);
      setGenerating(false);
    } finally {
      setNewStyleImages([]);
    }
  };

  const handleRegenerate = async (imageId: number, customPrompt?: string) => {
    if (!project || generating) return;

    // 找到这张图，拿到它的 shotIndex（场景图无 shotIndex，按整任务重做）
    const img = images.find(i => i.id === imageId) || liveImages.find(i => i.id === imageId);
    if (!img) {
      console.warn('未找到要重做的图片:', imageId);
      return;
    }

    const moduleType = project.moduleType || 'product';
    const shotIndex = img.shotIndex;

    try {
      // 删除该张旧结果（避免重复）
      await db.images.delete(imageId);
      setImages(prev => prev.filter(i => i.id !== imageId));
      setLiveImages(prev => prev.filter(i => i.id !== imageId));

      if (moduleType === 'scene' || !shotIndex) {
        // 场景图：整张重做
        await handleStartGeneration(undefined, customPrompt);
      } else {
        // 产品图：只重做这一镜次
        await handleStartGeneration([shotIndex], customPrompt);
      }
    } catch (e) {
      console.error('重新生成失败:', e);
      setErrorMessage(e instanceof Error ? e.message : '重新生成失败');
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
    return size.id === 'custom' ? `自定义 (${size.aspectRatio})` : `${size.label} ${size.aspectRatio}`;
  })();

  // 生成按钮文案
  const getGenerateLabel = () => {
    if (!project) return '生成';
    const moduleType = project.moduleType || 'product';
    if (moduleType === 'product') {
      return `全部生成 ${parseSelectedShots(project.selectedShots).length} 张产品图`;
    }
    return '开始生成场景图';
  };

  const getShotCount = () => {
    if (!project) return 7;
    return parseSelectedShots(project.selectedShots).length;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-light)] flex items-center justify-center mx-auto mb-4">
            <Loader className="w-6 h-6 text-[var(--color-accent)] animate-spin" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">加载中...</p>
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
    if (generationPhase === 'analyzing') return '正在分析服装特征...';
    if (isFinishingUp) return '图片处理中，即将完成...';
    if (moduleType === 'product') return `已生成 ${liveImages.length} / ${progress.total} 张`;
    return '正在生成场景图...';
  })();

  const phaseSubLabel = (() => {
    if (generationPhase === 'analyzing') return '服装分析中';
    if (isFinishingUp) return '收尾中';
    if (moduleType === 'product') return `正在生成镜次 #${progress.shotIndex}`;
    return '场景图';
  })();

  const progressBarWidth = generationPhase === 'analyzing'
    ? '8%'
    : `${Math.max(8, Math.min(100, (liveImages.length / Math.max(progress.total, 1)) * 100))}%`;

  const paramChips = (
    <div className="flex flex-wrap gap-2">
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
          if (!generating && project.status !== 'pending') {
            // 直接触发整任务重做：附带从 chat 提取的 customPrompt
            const customPrompt = pendingChatPromptRef.current;
            pendingChatPromptRef.current = '';
            handleStartGeneration(undefined, customPrompt || undefined);
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
              <span className="text-lg font-semibold tracking-tight">SILKMOMO</span>
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
                  <Clock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                  等待生成
                </span>
              )}
              {project.status === 'processing' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-accent)]/10 rounded-full text-[var(--color-accent)]">
                  <Loader className="w-3.5 h-3.5 animate-spin" />
                  {liveImages.length}/{progress.total}
                </span>
              )}
              {project.status === 'completed' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-green-50 rounded-full text-green-600">
                  <CheckCircle className="w-3.5 h-3.5" />
                  已完成
                </span>
              )}
              {project.status === 'failed' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-red-50 rounded-full text-red-500">
                  <XCircle className="w-3.5 h-3.5" />
                  失败
                </span>
              )}

              {/* 调整参数按钮 */}
              {(project.status === 'completed' || project.status === 'failed') && !generating && (
                <button
                  onClick={() => setShowAdjustPanel(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-white rounded-xl hover:bg-[var(--color-accent-dark)] transition-colors"
                >
                  <Settings2 className="w-4 h-4" />
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
              >
                <X className="w-5 h-5 text-[var(--color-text-muted)]" />
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
                onClick={handleRegenerateWithNewParams}
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
                  <p className="text-xs text-[var(--color-text-muted)]">
                    已耗时 {elapsedSeconds}s
                    {elapsedSeconds > 90 && <span className="text-amber-500 ml-1">（响应较慢，请稍候）</span>}
                  </p>
                </div>
              </div>

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
                    index: img.index
                  }))}
                  onRegenerate={() => {}}
                />
              </div>
            )}

            {/* 错误汇总（非 fatal，继续生成中的部分失败） */}
            {generationErrors.filter(e => !e.fatal).length > 0 && (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <p className="text-sm font-medium text-amber-700">部分镜次生成失败（生成继续）</p>
                </div>
                {generationErrors.filter(e => !e.fatal).map((e, i) => (
                  <p key={i} className="text-xs text-amber-600 font-mono mt-1">
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
              <Wand2 className="w-8 h-8 text-[var(--color-accent)]" strokeWidth={1.5} />
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

            {/* 生成前最后一次模特微调 */}
            <div className="mb-8 px-4 sm:px-8 text-left">
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

        {/* 试生成完成 → 生成剩余按钮 */}
        {trialDone && !generating && images.length > 0 && images.length < getShotCount() && (
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
                className="flex items-center gap-2 px-4 py-2 text-sm border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-background)] text-[var(--color-text-secondary)] transition-colors"
              >
                <Settings2 className="w-4 h-4" />
                调整参数
              </button>
              <button
                onClick={handleGenerateRemaining}
                className="btn-primary text-sm px-5 py-2"
              >
                <Wand2 className="w-4 h-4" strokeWidth={1.5} />
                生成剩余 {getShotCount() - images.length} 张
              </button>
            </div>
          </div>
        )}

        {/* 结果展示 */}
        {images.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              生成结果 · {images.length} 张
            </h2>

            <div className="mb-6">{paramChips}</div>

            <ResultGallery
              images={images.map(img => ({
                id: img.id!,
                type: img.imageType || 'close_up',
                imageType: img.imageType || 'close_up',
                data: img.data,
                prompt: img.prompt,
                index: img.index
              }))}
              onRegenerate={handleRegenerate}
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

            {/* SSE 过程中的详细错误列表 */}
            {generationErrors.length > 0 && (
              <div className="max-w-lg mx-auto mb-6">
                <div className="p-4 bg-[var(--color-background)] rounded-2xl text-left">
                  <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">错误详情</p>
                  {generationErrors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600 font-mono mt-1">
                      {e.shotIndex >= 0 ? `镜次 #${e.shotIndex}: ` : ''}{e.message}
                    </p>
                  ))}
                </div>
              </div>
            )}

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
            SILKMOMO © 2025 · 奢华丝绸，AI 赋能
          </p>
        </div>
      </footer>
      </div>
    </div>
  );
}
