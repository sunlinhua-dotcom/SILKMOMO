'use client';

import { useEffect, useState, useCallback } from 'react';
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
} from '@/lib/models';
import {
  generateProductShots, generateSceneShots,
  getRandomWaitingMessage,
} from '@/lib/api';
import { Clock, CheckCircle, XCircle, Loader, Wand2, Settings2, X, RefreshCcw } from 'lucide-react';
import { Logo } from '@/components/Logo';
import Link from 'next/link';
import type { CompressedImage } from '@/lib/image-compressor';

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
  const [trialDone, setTrialDone] = useState(false); // 试生成已完成

  // --- 调整参数面板 State ---
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newBodyType, setNewBodyType] = useState<'slim' | 'standard' | 'curvy'>(DEFAULT_BODY_TYPE.id);
  const [newSkinTone, setNewSkinTone] = useState<'light' | 'medium' | 'deep'>(DEFAULT_SKIN_TONE.id);
  const [newStyleImages, setNewStyleImages] = useState<CompressedImage[]>([]);

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

  // ===== 核心：先试一张（省钱模式） =====
  const handleTrialGeneration = async () => {
    if (!project || inputImages.products.length === 0) return;
    const moduleType = project.moduleType || 'product';
    if (moduleType !== 'product') {
      // 场景图只有 1 张，直接走全量生成
      return handleStartGeneration();
    }

    setGenerating(true);
    setErrorMessage(null);

    const productImgs = inputImages.products.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const modelRefImgs = inputImages.modelRefs.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const accessoryImgs = inputImages.accessories.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const bgRefImgs = inputImages.bgRefs.map(img => ({ data: img.data, mimeType: img.mimeType }));

    const modelConfig = project.modelId ? MODELS.find(m => m.id === project.modelId) : undefined;
    const bodyTypeConfig = BODY_TYPES.find(b => b.id === (project.bodyType || DEFAULT_BODY_TYPE.id));
    const skinToneConfig = SKIN_TONES.find(s => s.id === (project.skinTone || DEFAULT_SKIN_TONE.id));
    const selectedShotIndexes: number[] = project.selectedShots ? JSON.parse(project.selectedShots) : [1, 2, 3, 4, 9];
    const firstShotConfig = PRODUCT_SHOTS.find(s => s.index === selectedShotIndexes[0]);

    if (!firstShotConfig) {
      setGenerating(false);
      return;
    }

    const outputSizeConfig = PRODUCT_OUTPUT_SIZES.find(s => s.id === project.outputSize) || PRODUCT_OUTPUT_SIZES[0];

    try {
      await db.projects.update(taskId, { status: 'processing' });
      setProject(prev => prev ? { ...prev, status: 'processing' } : null);
      setProgress({ current: 1, total: 1, shotIndex: firstShotConfig.index });

      // 只生成第 1 张
      const results = await generateProductShots(
        [firstShotConfig],
        productImgs,
        {
          modelConfig,
          bodyTypeConfig,
          skinToneConfig,
          modelRefImages: modelRefImgs.length > 0 ? modelRefImgs : undefined,
          bgRefImages: bgRefImgs.length > 0 ? bgRefImgs : undefined,
          accessoryImages: accessoryImgs.length > 0 ? accessoryImgs : undefined,
          outputSize: outputSizeConfig,
        },
        (current, total, shotIdx) => setProgress({ current, total, shotIndex: shotIdx })
      );

      if (results[0]?.data && !results[0]?.error) {
        const shotConfig = PRODUCT_SHOTS.find(s => s.index === results[0].shotIndex);
        await db.images.add({
          projectId: taskId,
          type: 'result',
          data: results[0].data,
          mimeType: 'image/png',
          shotIndex: results[0].shotIndex,
          frameType: shotConfig?.frameType,
          shootingAngle: shotConfig?.angle,
          hasModel: shotConfig?.hasModel,
          imageType: shotConfig?.frameType === 'full_body' ? 'full_body' : shotConfig?.frameType === 'upper_body' ? 'half_body' : 'close_up',
          index: results[0].shotIndex,
        });
        setTrialDone(true);
        await db.projects.update(taskId, { status: 'completed', updatedAt: new Date() });
      } else {
        setErrorMessage(results[0]?.error || '试生成失败');
        await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
      }

      await loadTaskData();
    } catch (error) {
      console.error('试生成失败:', error);
      setErrorMessage(error instanceof Error ? error.message : '未知错误');
      await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
    } finally {
      setGenerating(false);
    }
  };

  // ===== 生成剩余（试过 1 张后追加生成） =====
  const handleGenerateRemaining = async () => {
    if (!project || inputImages.products.length === 0) return;

    setGenerating(true);
    setErrorMessage(null);

    const productImgs = inputImages.products.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const modelRefImgs = inputImages.modelRefs.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const accessoryImgs = inputImages.accessories.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const bgRefImgs = inputImages.bgRefs.map(img => ({ data: img.data, mimeType: img.mimeType }));

    const modelConfig = project.modelId ? MODELS.find(m => m.id === project.modelId) : undefined;
    const bodyTypeConfig = BODY_TYPES.find(b => b.id === (project.bodyType || DEFAULT_BODY_TYPE.id));
    const skinToneConfig = SKIN_TONES.find(s => s.id === (project.skinTone || DEFAULT_SKIN_TONE.id));
    const selectedShotIndexes: number[] = project.selectedShots ? JSON.parse(project.selectedShots) : [1, 2, 3, 4, 9];

    // 排除已生成的镜次
    const existingResults = await db.images.where('projectId').equals(taskId).filter(img => img.type === 'result').toArray();
    const existingShotIndexes = existingResults.map(img => img.shotIndex).filter(Boolean) as number[];
    const remainingIndexes = selectedShotIndexes.filter(idx => !existingShotIndexes.includes(idx));
    const remainingShots = PRODUCT_SHOTS.filter(s => remainingIndexes.includes(s.index));

    if (remainingShots.length === 0) {
      setGenerating(false);
      return;
    }

    const outputSizeConfig = PRODUCT_OUTPUT_SIZES.find(s => s.id === project.outputSize) || PRODUCT_OUTPUT_SIZES[0];

    try {
      await db.projects.update(taskId, { status: 'processing' });
      setProject(prev => prev ? { ...prev, status: 'processing' } : null);
      setProgress({ current: 0, total: remainingShots.length, shotIndex: 0 });

      const results = await generateProductShots(
        remainingShots,
        productImgs,
        {
          modelConfig,
          bodyTypeConfig,
          skinToneConfig,
          modelRefImages: modelRefImgs.length > 0 ? modelRefImgs : undefined,
          bgRefImages: bgRefImgs.length > 0 ? bgRefImgs : undefined,
          accessoryImages: accessoryImgs.length > 0 ? accessoryImgs : undefined,
          outputSize: outputSizeConfig,
        },
        (current, total, shotIdx) => setProgress({ current, total, shotIndex: shotIdx })
      );

      let successCount = 0;
      for (const result of results) {
        if (result.data && !result.error) {
          const shotConfig = PRODUCT_SHOTS.find(s => s.index === result.shotIndex);
          await db.images.add({
            projectId: taskId,
            type: 'result',
            data: result.data,
            mimeType: 'image/png',
            shotIndex: result.shotIndex,
            frameType: shotConfig?.frameType,
            shootingAngle: shotConfig?.angle,
            hasModel: shotConfig?.hasModel,
            imageType: shotConfig?.frameType === 'full_body' ? 'full_body' : shotConfig?.frameType === 'upper_body' ? 'half_body' : 'close_up',
            index: result.shotIndex,
          });
          successCount++;
        }
      }

      const finalStatus = successCount > 0 ? 'completed' : 'failed';
      await db.projects.update(taskId, { status: finalStatus, updatedAt: new Date() });
      setTrialDone(false); // 已全量生成
      await loadTaskData();
    } catch (error) {
      console.error('生成剩余失败:', error);
      setErrorMessage(error instanceof Error ? error.message : '未知错误');
      await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
    } finally {
      setGenerating(false);
    }
  };

  // ===== 核心：根据 moduleType 分流生成（全量）  =====
  const handleStartGeneration = async () => {
    if (!project || inputImages.products.length === 0) return;

    setGenerating(true);
    setErrorMessage(null);

    const moduleType = project.moduleType || 'product';

    // 准备共用数据
    const productImgs = inputImages.products.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const modelRefImgs = inputImages.modelRefs.map(img => ({ data: img.data, mimeType: img.mimeType }));
    const accessoryImgs = inputImages.accessories.map(img => ({ data: img.data, mimeType: img.mimeType }));

    // 解析配置
    const modelConfig = project.modelId ? MODELS.find(m => m.id === project.modelId) : undefined;
    const bodyTypeConfig = BODY_TYPES.find(b => b.id === (project.bodyType || DEFAULT_BODY_TYPE.id));
    const skinToneConfig = SKIN_TONES.find(s => s.id === (project.skinTone || DEFAULT_SKIN_TONE.id));

    try {
      await db.projects.update(taskId, { status: 'processing' });
      setProject(prev => prev ? { ...prev, status: 'processing' } : null);

      if (moduleType === 'product') {
        // ─── 产品图模块 ───
        const selectedShotIndexes: number[] = project.selectedShots
          ? JSON.parse(project.selectedShots)
          : [1, 2, 3, 4, 9]; // fallback
        const selectedShotConfigs = PRODUCT_SHOTS.filter(s => selectedShotIndexes.includes(s.index));
        const bgRefImgs = inputImages.bgRefs.map(img => ({ data: img.data, mimeType: img.mimeType }));

        // 解析输出尺寸
        const outputSizeConfig = PRODUCT_OUTPUT_SIZES.find(s => s.id === project.outputSize)
          || PRODUCT_OUTPUT_SIZES[0];

        setProgress({ current: 0, total: selectedShotConfigs.length, shotIndex: 0 });

        const results = await generateProductShots(
          selectedShotConfigs,
          productImgs,
          {
            modelConfig,
            bodyTypeConfig,
            skinToneConfig,
            modelRefImages: modelRefImgs.length > 0 ? modelRefImgs : undefined,
            bgRefImages: bgRefImgs.length > 0 ? bgRefImgs : undefined,
            accessoryImages: accessoryImgs.length > 0 ? accessoryImgs : undefined,
            outputSize: outputSizeConfig,
          },
          (current, total, shotIdx) => setProgress({ current, total, shotIndex: shotIdx })
        );

        let successCount = 0;
        for (const result of results) {
          if (result.data && !result.error) {
            const shotConfig = PRODUCT_SHOTS.find(s => s.index === result.shotIndex);
            await db.images.add({
              projectId: taskId,
              type: 'result',
              data: result.data,
              mimeType: 'image/png',
              shotIndex: result.shotIndex,
              frameType: shotConfig?.frameType,
              shootingAngle: shotConfig?.angle,
              hasModel: shotConfig?.hasModel,
              imageType: shotConfig?.frameType === 'full_body' ? 'full_body'
                : shotConfig?.frameType === 'upper_body' ? 'half_body'
                : 'close_up',
              index: result.shotIndex,
            });
            successCount++;
          }
        }

        const finalStatus = successCount > 0 ? 'completed' : 'failed';
        if (successCount === 0 && results.length > 0 && results[0].error) {
          setErrorMessage(results[0].error);
        }
        await db.projects.update(taskId, { status: finalStatus, updatedAt: new Date() });

      } else {
        // ─── 场景图模块 ───
        const sceneRefImgs = inputImages.sceneRefs.map(img => ({ data: img.data, mimeType: img.mimeType }));

        if (sceneRefImgs.length === 0) {
          setErrorMessage('场景图模块需要上传场景参考图');
          await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
          setGenerating(false);
          return;
        }

        const outputSizeConfig = SCENE_OUTPUT_SIZES.find(s => s.id === project.sceneOutputSize)
          || SCENE_OUTPUT_SIZES[0];

        setProgress({ current: 0, total: 1, shotIndex: 0 });

        const results = await generateSceneShots(
          1,
          productImgs,
          sceneRefImgs,
          {
            modelConfig,
            bodyTypeConfig,
            skinToneConfig,
            modelRefImages: modelRefImgs.length > 0 ? modelRefImgs : undefined,
            accessoryImages: accessoryImgs.length > 0 ? accessoryImgs : undefined,
            outputSize: outputSizeConfig,
            hasModel: true, // 可扩展：从 project 中读取
          },
          (current, total) => setProgress({ current, total, shotIndex: 0 })
        );

        let successCount = 0;
        for (const result of results) {
          if (result.data && !result.error) {
            await db.images.add({
              projectId: taskId,
              type: 'result',
              data: result.data,
              mimeType: 'image/png',
              imageType: 'hero',
              index: result.index,
            });
            successCount++;
          }
        }

        const finalStatus = successCount > 0 ? 'completed' : 'failed';
        if (successCount === 0 && results.length > 0 && results[0].error) {
          setErrorMessage(results[0].error);
        }
        await db.projects.update(taskId, { status: finalStatus, updatedAt: new Date() });
      }

      await loadTaskData();

    } catch (error) {
      console.error('生成失败:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(errorMsg);
      await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
      setProject(prev => prev ? { ...prev, status: 'failed' } : null);
    } finally {
      setGenerating(false);
    }
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

  const handleRegenerate = async (imageId: number) => {
    console.log('重新生成图片:', imageId);
  };

  // 获取当前模特名称
  const currentModelName = project?.modelId ? MODELS.find(m => m.id === project.modelId)?.name : '未选择预设模特';
  const currentBodyTypeName = BODY_TYPES.find(b => b.id === project?.bodyType)?.name || DEFAULT_BODY_TYPE.name;
  const currentSkinToneName = SKIN_TONES.find(s => s.id === project?.skinTone)?.name || DEFAULT_SKIN_TONE.name;

  // 生成按钮文案
  const getGenerateLabel = () => {
    if (!project) return '生成';
    const moduleType = project.moduleType || 'product';
    if (moduleType === 'product') {
      const shotCount = project.selectedShots ? JSON.parse(project.selectedShots).length : 7;
      return `全部生成 ${shotCount} 张产品图`;
    }
    return '开始生成场景图';
  };

  const getShotCount = () => {
    if (!project) return 7;
    return project.selectedShots ? JSON.parse(project.selectedShots).length : 7;
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

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
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
                  {progress.current}/{progress.total}
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
        {/* 生成中状态 */}
        {generating && (
          <div className="mb-12 text-center py-16 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center shadow-lg">
              <Wand2 className="w-10 h-10 text-white animate-pulse" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-semibold mb-3">
              {moduleType === 'product' ? '正在生成产品图组' : '正在生成场景图'}
            </h2>
            <p className="text-[var(--color-text-secondary)] mb-8 max-w-md mx-auto">{waitingMessage}</p>
            <div className="max-w-sm mx-auto">
              <div className="h-2 bg-[var(--color-background)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-light)] transition-all duration-500 rounded-full"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mt-3">
                {moduleType === 'product'
                  ? `正在生成第 ${progress.current} 张，共 ${progress.total} 张（镜次 #${progress.shotIndex}）`
                  : `正在生成场景图...`
                }
              </p>
            </div>
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
                <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-[var(--color-accent)] shadow-sm">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="产品"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">产品</p>
              </div>
            ))}
            {inputImages.modelRefs.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-purple-300 shadow-sm">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="模特参考"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">模特参考</p>
              </div>
            ))}
            {inputImages.bgRefs.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-[var(--color-border)] opacity-80">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="背景参考"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">背景</p>
              </div>
            ))}
            {inputImages.sceneRefs.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-green-300 opacity-80">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="场景参考"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">场景</p>
              </div>
            ))}
            {inputImages.accessories.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-dashed border-[var(--color-border)] opacity-60">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="配件"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-1">配件</p>
              </div>
            ))}
          </div>

          {/* 参数概览 */}
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
              体型: {currentBodyTypeName}
            </span>
            <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
              肤色: {currentSkinToneName}
            </span>
            {project.modelId && (
              <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
                模特: {currentModelName}
              </span>
            )}
            {moduleType === 'product' && project.skuType && (
              <span className="text-xs px-2.5 py-1 bg-[var(--color-background)] rounded-lg text-[var(--color-text-secondary)]">
                SKU: {project.skuType === 'outfit' ? '套装' : project.skuType === 'top' ? '上装' : '下装'}
              </span>
            )}
          </div>
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
                  onClick={handleStartGeneration}
                  className="flex items-center gap-2 px-6 py-3 text-sm font-medium border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-background)] text-[var(--color-text-secondary)] transition-colors"
                >
                  {getGenerateLabel()}
                </button>
              </div>
            ) : (
              <button
                onClick={handleStartGeneration}
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
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-6 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              生成结果 · {images.length} 张
            </h2>
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

        {/* 失败状态 */}
        {project.status === 'failed' && images.length === 0 && (
          <div className="text-center py-20 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
              <XCircle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">生成失败</h2>
            <p className="text-[var(--color-text-secondary)] mb-4 text-sm max-w-md mx-auto">
              请检查网络连接或稍后重试
            </p>
            {errorMessage && (
              <div className="max-w-md mx-auto mb-8 p-4 bg-[var(--color-background)] rounded-xl">
                <p className="text-xs text-[var(--color-text-muted)] font-mono break-all">
                  {errorMessage}
                </p>
              </div>
            )}
            <button
              onClick={handleStartGeneration}
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
  );
}
