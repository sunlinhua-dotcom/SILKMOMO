'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { History, Pencil, Plus, Sparkles, Star, Trash2, Wand2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { UserNav } from '@/components/UserNav';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { ImageUploader } from '@/components/ImageUploader';
import { EngineSelector, type ImageEngine } from '@/components/EngineSelector';
import { GPTQualitySelector } from '@/components/GPTQualitySelector';
import { MAX_TOTAL_GARMENTS } from '@/components/LookbookGarmentSlots';
import { DEFAULT_BODY_TYPE, DEFAULT_SKIN_TONE, SCENE_OUTPUT_SIZES } from '@/lib/models';
import { getGenerationCostFen, type GenerationQuality } from '@/lib/billing-constants';
import type { CompressedImage } from '@/lib/image-compressor';
import { db, migrateLegacyStylePackImages, prepareProjectImageSlot } from '@/lib/db';

// 后端 sceneRefImages 硬上限 20（stream/route.ts validateImageInputs）
const LOOKBOOK_MAX = 20;
const PRODUCT_GROUP_MAX = 8;
const PRODUCT_GROUP_IMAGE_MAX = 4;
const MODEL_FACE_BATCH_SIZE = 3;
const MODEL_FACE_PRICE_FEN = getGenerationCostFen('openai', 'medium');

type LookbookMode = 'swap' | 'products';
type ModelIdentityMode = 'fresh' | 'follow_scene';

interface ModelFaceRecord {
  id: string;
  image: string;
  mimeType: string;
  specIndex: number;
  recipeLabel: string;
  favorite: boolean;
  name: string;
  createdAt: string;
}

interface ModelFaceJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  error?: string | null;
  items: Array<{ id: string; status: string; error?: string | null }>;
}

const MODEL_IDENTITY_OPTIONS: Array<{
  id: ModelIdentityMode;
  label: string;
  description: string;
}> = [
  {
    id: 'follow_scene',
    label: '贴近场景模特',
    description: '肤色、发型发色、体型都与场景图模特一致，仅对五官做局部调整（部分换脸），最大程度还原参考图。',
  },
  {
    id: 'fresh',
    label: '全新模特',
    description: '换成明显不同的全新虚构模特，整组保持同一个人。',
  },
];

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

function ModelIdentitySelector({
  value,
  onChange,
  radioName,
  freshContent,
}: {
  value: ModelIdentityMode;
  onChange: (mode: ModelIdentityMode) => void;
  radioName: string;
  freshContent?: ReactNode;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MODEL_IDENTITY_OPTIONS.map((option) => (
        <div
          key={option.id}
          className={`h-full rounded-xl border transition-all duration-200 ${
            value === option.id
              ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.05)]'
              : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
          }`}
        >
          <label className="flex cursor-pointer flex-col gap-2 p-4">
            <input
              type="radio"
              name={radioName}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
              className="sr-only"
            />
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
              <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                value === option.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
              }`}>
                {value === option.id && <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />}
              </span>
              {option.label}
            </span>
            <span className="pl-6 text-xs leading-relaxed text-[var(--color-text-muted)]">
              {option.description}
            </span>
          </label>
          {option.id === 'fresh' && value === 'fresh' && freshContent && (
            <div className="border-t border-[var(--color-border-light)] p-4">{freshContent}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ModelFaceLibraryPanel({
  faces,
  chosenFaceId,
  job,
  loading,
  error,
  balanceFen,
  onChoose,
  onGenerate,
  onResume,
  onUpdate,
  onDelete,
}: {
  faces: ModelFaceRecord[];
  chosenFaceId: string | null;
  job: ModelFaceJob | null;
  loading: boolean;
  error: string | null;
  balanceFen: number | null;
  onChoose: (id: string | null) => void;
  onGenerate: () => void;
  onResume: () => void;
  onUpdate: (id: string, patch: { favorite?: boolean; name?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const batchCostFen = MODEL_FACE_PRICE_FEN * MODEL_FACE_BATCH_SIZE;
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text)]">御用 AI 模特脸库</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">
            每次增量生成 3 张，按账号保存并跨设备同步。点星标设为御用；不手选时优先随机使用御用脸。每张 ¥{(MODEL_FACE_PRICE_FEN / 100).toFixed(2)}。
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading || balanceFen === null || balanceFen < batchCostFen}
          className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-[var(--color-accent)] text-[var(--color-accent)] disabled:opacity-50"
        >
          {loading ? '生成中…' : '再出 3 张'}
        </button>
      </div>

      {faces.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {faces.map((face, index) => (
            <div key={face.id} className="relative group">
              <button
                type="button"
                onClick={() => onChoose(chosenFaceId === face.id ? null : face.id)}
                className={`relative w-full aspect-[3/4] rounded-lg overflow-hidden border-2 transition ${
                  chosenFaceId === face.id
                    ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30'
                    : 'border-transparent hover:border-[var(--color-border-light)]'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${face.mimeType};base64,${face.image}`}
                  alt={face.name || `御用模特脸 ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
              <div className="absolute top-1 right-1 flex gap-1">
                <button
                  type="button"
                  title={face.favorite ? '取消御用' : '设为御用'}
                  onClick={() => void onUpdate(face.id, { favorite: !face.favorite })}
                  className="rounded-md bg-black/55 p-1 text-white"
                >
                  <Star size={13} fill={face.favorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  title="命名"
                  onClick={() => {
                    const name = window.prompt('给这张御用脸命名', face.name);
                    if (name !== null) void onUpdate(face.id, { name });
                  }}
                  className="rounded-md bg-black/55 p-1 text-white"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  title="删除"
                  onClick={() => void onDelete(face.id)}
                  className="rounded-md bg-black/55 p-1 text-white"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">
                {face.name || face.recipeLabel}
              </p>
            </div>
          ))}
        </div>
      )}

      {job && loading && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          正在生成 {job.completedCount + job.failedCount}/{job.requestedCount}；可离开页面，回来后会自动接上。
        </p>
      )}
      {job?.status === 'failed' && job.items.some(item => item.status === 'pending') && (
        <button
          type="button"
          onClick={onResume}
          className="mt-2 text-xs text-[var(--color-accent)] underline underline-offset-2"
        >
          继续生成
        </button>
      )}
      {balanceFen !== null && balanceFen < batchCostFen && (
        <p className="mt-2 text-xs text-amber-600">余额不足，生成 3 张需要 ¥{(batchCostFen / 100).toFixed(2)}。</p>
      )}
      {error && <p className="mt-2 text-xs text-amber-600">{error}</p>}
      {chosenFaceId !== null && (
        <p className="mt-2 text-xs text-[var(--color-accent)]">
          已选中这张完整身份锚，整组图都会使用同一位虚构模特。再点一次可取消。
        </p>
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
  const [modelIdentityMode, setModelIdentityMode] = useState<ModelIdentityMode>('follow_scene');
  const [faceCandidates, setFaceCandidates] = useState<ModelFaceRecord[]>([]);
  const [chosenFaceId, setChosenFaceId] = useState<string | null>(null);
  const [faceJob, setFaceJob] = useState<ModelFaceJob | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);
  const lastSyncedCompletedCount = useRef(0);
  const [lookbookImages, setLookbookImages] = useState<CompressedImage[]>([]); // → scene_ref
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
  const productReferenceImages = groupGarments.other || [];
  const sceneUploadEnabled = productReferenceImages.length > 0;
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

  const refreshModelFaces = useCallback(async () => {
    const res = await fetch('/api/model-faces');
    if (!res.ok) throw new Error('脸库读取失败');
    const data = await res.json();
    const faces = Array.isArray(data.faces) ? data.faces as ModelFaceRecord[] : [];
    setFaceCandidates(faces);
  }, []);

  const pollModelFaceJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/model-face/jobs/${jobId}`);
    if (!res.ok) throw new Error('任务状态读取失败');
    const data = await res.json();
    const job = data.job as ModelFaceJob;
    setFaceJob(job);
    if (typeof data.balanceFen === 'number') {
      setCurrentUser(current => current ? { ...current, balanceFen: data.balanceFen } : current);
    }
    if (job.completedCount > lastSyncedCompletedCount.current) {
      await refreshModelFaces();
      lastSyncedCompletedCount.current = job.completedCount;
    }
    if (job.error) setFaceError(job.error);
    return job;
  }, [refreshModelFaces]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/model-faces').then(res => res.ok ? res.json() : Promise.reject()),
      fetch('/api/model-face').then(res => res.ok ? res.json() : Promise.reject()),
    ]).then(([libraryData, jobData]) => {
      if (!alive) return;
      const faces = Array.isArray(libraryData.faces) ? libraryData.faces as ModelFaceRecord[] : [];
      setFaceCandidates(faces);
      if (jobData.job) {
        setFaceJob(jobData.job);
        lastSyncedCompletedCount.current = jobData.job.completedCount;
      }
    }).catch(() => { if (alive) setFaceError('脸库读取失败，请刷新重试'); });
    return () => { alive = false; };
  }, []);

  const facesLoading = faceJob?.status === 'queued' || faceJob?.status === 'running';

  useEffect(() => {
    if (!faceJob || !facesLoading) return;
    const intervalId = window.setInterval(() => {
      void pollModelFaceJob(faceJob.id).catch(() => setFaceError('任务状态暂时无法读取，稍后自动重试'));
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [faceJob, facesLoading, pollModelFaceJob]);

  const submitFaceJob = async (body: { count: number } | { resumeJobId: string }) => {
    if (facesLoading) return;
    setFaceError(null);
    if ('count' in body) lastSyncedCompletedCount.current = 0;
    const res = await fetch('/api/model-face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.jobId) await pollModelFaceJob(data.jobId).catch(() => undefined);
      setFaceError(data.error || '模特脸任务创建失败');
      return;
    }
    await pollModelFaceJob(data.jobId);
  };

  const handleGenerateFaces = () => submitFaceJob({ count: MODEL_FACE_BATCH_SIZE });
  const handleResumeFaceJob = () => faceJob && submitFaceJob({ resumeJobId: faceJob.id });

  const updateModelFace = async (id: string, patch: { favorite?: boolean; name?: string }) => {
    try {
      const res = await fetch(`/api/model-faces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('模特脸更新失败');
      await refreshModelFaces();
    } catch {
      setFaceError('模特脸更新失败，请稍后重试');
    }
  };

  const deleteModelFace = async (id: string) => {
    if (!window.confirm('确定从御用脸库删除这张脸吗？')) return;
    try {
      const res = await fetch(`/api/model-faces/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('模特脸删除失败');
      if (chosenFaceId === id) setChosenFaceId(null);
      await refreshModelFaces();
    } catch {
      setFaceError('模特脸删除失败，请稍后重试');
    }
  };

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
        ...(modelIdentityMode === 'fresh' ? {
          bodyType: DEFAULT_BODY_TYPE.id,
          skinTone: DEFAULT_SKIN_TONE.id,
        } : {}),
        engine: selectedEngine,
        generationQuality: selectedEngine === 'openai' ? selectedQuality : undefined,
        sceneOutputSize,
        sceneHasModel: true,
        sceneGroup: true,
        sceneGroupMode: mode,
        modelIdentityMode,
        sceneGroupCategories: mode === 'products'
          ? JSON.stringify(productModeLabels)
          : JSON.stringify(
              Object.keys(groupGarments).filter(k => (groupGarments[k]?.length || 0) > 0),
            ),
        customWidth: sceneOutputSize === 'custom' ? sceneCustomW : undefined,
        customHeight: sceneOutputSize === 'custom' ? sceneCustomH : undefined,
      });

      const chosen = faceCandidates.find(face => face.id === chosenFaceId);
      await prepareProjectImageSlot(projectId as number);

      if (modelIdentityMode === 'fresh' && chosen) {
        await db.images.add({
          projectId, type: 'anchor', data: chosen.image, mimeType: chosen.mimeType,
        });
        await db.projects.update(projectId as number, { modelFaceChosen: true, modelFaceId: chosen.id });
      }

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
            先上传产品参考图，再上传场景主图；每张场景主图各出 1 张，只把衣服换成你的产品。
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
            {/* ① 产品参考图 */}
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[rgba(201,168,108,0.2)]">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">① 上传产品参考图</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">
                    仅用于识别服装细节，其背景/滤镜不会出现在成图中。
                  </p>
                </div>
                {productReferenceImages.length > 0 && (
                  <span className="shrink-0 text-xs text-[var(--color-accent)] font-medium tabular-nums">
                    {productReferenceImages.length}/{MAX_TOTAL_GARMENTS} 张
                  </span>
                )}
              </div>
              <ImageUploader
                title="产品参考图"
                description="仅用于识别服装细节，其背景/滤镜不会出现在成图中"
                required
                maxFiles={MAX_TOTAL_GARMENTS}
                images={productReferenceImages}
                onImagesChange={(imgs) => handleGroupGarmentChange('other', imgs)}
                variant="gold"
              />
              {groupGarmentImages.length === 0 && (
                <p className="mt-2 text-xs text-amber-600">请至少上传一张产品参考图。</p>
              )}
              {groupGarmentImages.length > MAX_TOTAL_GARMENTS && (
                <p className="mt-2 text-xs text-amber-600">产品参考图最多 {MAX_TOTAL_GARMENTS} 张，请减少后再生成。</p>
              )}
            </div>

            {/* ② 场景主图 */}
            <div
              className={`bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border transition-opacity ${
                sceneUploadEnabled
                  ? 'border-[rgba(201,168,108,0.2)]'
                  : 'border-[var(--color-border-light)] opacity-60'
              }`}
              aria-disabled={!sceneUploadEnabled}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">② 上传场景主图</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">
                    每张场景主图各出 1 张图，保留场景照的模特姿势、构图与氛围，只把衣服换成你的产品。
                  </p>
                </div>
                {lookbookImages.length > 0 && (
                  <span className="shrink-0 text-xs text-[var(--color-accent)] font-medium tabular-nums">
                    已传 {lookbookImages.length} 张
                  </span>
                )}
              </div>
              {sceneUploadEnabled ? (
                <>
                  <ImageUploader
                    title="场景主图"
                    description={`每张场景主图各出 1 张图，最多 ${LOOKBOOK_MAX} 张`}
                    required
                    maxFiles={LOOKBOOK_MAX}
                    images={lookbookImages}
                    onImagesChange={setLookbookImages}
                    variant="gold"
                  />
                  {lookbookImages.length > 0 && (
                    <p className="mt-3 text-xs font-medium text-[var(--color-accent)]">
                      共将生成 {lookbookImages.length} 张（= 场景主图数量）
                    </p>
                  )}
                  {lookbookImages.length > LOOKBOOK_MAX && (
                    <p className="mt-2 text-xs text-amber-600">最多 {LOOKBOOK_MAX} 张，请减少后再生成。</p>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--color-border-light)] bg-[var(--color-background)]/60 px-4 py-6 text-center">
                  <p className="text-xs text-[var(--color-text-muted)]">先完成第 1 步上传产品参考图，再上传场景主图。</p>
                </div>
              )}
            </div>

            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">③ 模特</h3>
              <ModelIdentitySelector
                value={modelIdentityMode}
                onChange={setModelIdentityMode}
                radioName="swapModelIdentityMode"
                freshContent={(
                  <ModelFaceLibraryPanel
                    faces={faceCandidates}
                    chosenFaceId={chosenFaceId}
                    job={faceJob}
                    loading={facesLoading}
                    error={faceError}
                    balanceFen={currentUser?.balanceFen ?? null}
                    onChoose={setChosenFaceId}
                    onGenerate={handleGenerateFaces}
                    onResume={handleResumeFaceJob}
                    onUpdate={updateModelFace}
                    onDelete={deleteModelFace}
                  />
                )}
              />
            </div>

            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">④ 替换附件（选填）</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                留空则保留场景主图里原有的包、首饰、鞋帽等附件；上传则替换。
              </p>
              <ImageUploader
                title="附件参考图"
                description="上传要替换的附件（包 / 首饰 / 项链等，最多 6 张）"
                maxFiles={6}
                images={accessoryImages}
                onImagesChange={setAccessoryImages}
                variant="gold"
              />
            </div>

            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">⑤ 输出尺寸</h3>
              <OutputSizeSelector
                value={sceneOutputSize}
                onChange={setSceneOutputSize}
                customWidth={sceneCustomW}
                customHeight={sceneCustomH}
                onCustomSizeChange={(w, h) => { setSceneCustomW(w); setSceneCustomH(h); }}
                radioName="swapOutputSize"
              />
            </div>
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
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">③ 模特</h3>
              <ModelIdentitySelector
                value={modelIdentityMode}
                onChange={setModelIdentityMode}
                radioName="productsModelIdentityMode"
                freshContent={(
                  <ModelFaceLibraryPanel
                    faces={faceCandidates}
                    chosenFaceId={chosenFaceId}
                    job={faceJob}
                    loading={facesLoading}
                    error={faceError}
                    balanceFen={currentUser?.balanceFen ?? null}
                    onChoose={setChosenFaceId}
                    onGenerate={handleGenerateFaces}
                    onResume={handleResumeFaceJob}
                    onUpdate={updateModelFace}
                    onDelete={deleteModelFace}
                  />
                )}
              />
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
                已上传 {groupGarmentImages.length} 张产品参考图
                {lookbookImages.length > 0
                  ? ` · 共将生成 ${lookbookImages.length} 张（= 场景主图数量）`
                  : ' · 上传场景主图后显示出图数'}
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
                : groupGarmentImages.length === 0
                  ? '先上传产品参考图'
                  : lookbookImages.length === 0
                    ? '再上传场景主图'
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
