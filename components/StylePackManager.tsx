'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  db,
  deleteStylePackImages,
  getStylePackImages,
  STYLE_PACK_IMAGE_PROJECT_ID,
  type ImageItem
} from '@/lib/db';
import { ImageUploader } from './ImageUploader';
import type { CompressedImage } from '@/lib/image-compressor';
import { Modal } from './ui/Modal';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { Plus, Package, Trash2, Check, X, ChevronDown, Eye, ImageOff } from 'lucide-react';

// 一张图片是否可用：base64 数据非空且看起来像合法 base64（不是 HTML 404 页之类）
function isValidImageData(img: ImageItem | undefined): boolean {
  if (!img?.data) return false;
  const head = img.data.slice(0, 16);
  // base64 字符集：A-Z a-z 0-9 + / =，HTML 404 页会以 "<!DOCTYPE" 等开头转 base64 后是 "PCFET..." 也合法
  // 所以再加一道：长度至少 200（合理图片缩略图至少几百字节 base64）
  return img.data.length > 200 && /^[A-Za-z0-9+/=\r\n]+$/.test(head);
}

export interface StylePack {
  id?: number;
  name: string;
  createdAt: Date;
  description?: string;
}

interface StylePackManagerProps {
  /** 当用户选中某个风格包时回调，传回该包的图片列表 */
  onApply?: (images: CompressedImage[]) => void;
  /** 当前已选中的风格包 ID */
  activePackId?: number;
  /** 变体：内联（嵌入页面）或 模态框 */
  variant?: 'inline' | 'compact';
}

export function StylePackManager({ onApply, activePackId, variant = 'inline' }: StylePackManagerProps) {
  const [packs, setPacks] = useState<StylePack[]>([]);
  const [packImages, setPackImages] = useState<Record<number, ImageItem[]>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [newPackName, setNewPackName] = useState('');
  const [newPackDesc, setNewPackDesc] = useState('');
  const [newPackImages, setNewPackImages] = useState<CompressedImage[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<number | undefined>(activePackId);
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const panelId = useId();

  const loadPacks = useCallback(async () => {
    const allPacks = await db.stylePacks.orderBy('createdAt').reverse().toArray();

    // 如果没有任何风格包，且没有初始化过，尝试加载预置的高定图片
    // 注意：预置文件可能不存在，必须严格校验响应才能写入 IndexedDB（否则会写坏数据导致缩略图全坏）
    if (allPacks.length === 0 && !localStorage.getItem('luxury_pack_init')) {
      try {
        const urls = ['/presets/luxury/deiji.jpg', '/presets/luxury/eberjey.jpg'];
        const base64Images: { base64: string; mimeType: string }[] = [];
        for (const url of urls) {
          const res = await fetch(url);
          // 必须 2xx 且返回真正的 image/* 内容；404 时 next 会回 HTML，不能用
          if (!res.ok) throw new Error(`preset ${url} HTTP ${res.status}`);
          const ct = res.headers.get('content-type') || '';
          if (!ct.startsWith('image/')) throw new Error(`preset ${url} content-type=${ct}`);
          const blob = await res.blob();
          if (blob.size < 1024) throw new Error(`preset ${url} too small (${blob.size}B)`);
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          const rawBase64 = base64.split(',')[1];
          base64Images.push({ base64: rawBase64, mimeType: blob.type });
        }

        const packId = await db.stylePacks.add({
          name: 'SILXINE 高定美学 (默认)',
          description: '基于 Deiji Studios / Eberjey 预设',
          createdAt: new Date(),
        });

        for (const img of base64Images) {
          await db.images.add({
            projectId: STYLE_PACK_IMAGE_PROJECT_ID,
            stylePackId: packId,
            type: 'scene_ref',
            data: img.base64,
            mimeType: img.mimeType,
          });
        }
        localStorage.setItem('luxury_pack_init', 'true');
      } catch (err) {
        // 预置文件不存在或无效：标记已尝试过，避免每次进入页面都触发 404
        console.warn('跳过默认风格包初始化（预置文件不可用）:', err);
        localStorage.setItem('luxury_pack_init', 'true');
      }
    }

    const freshPacks = await db.stylePacks.orderBy('createdAt').reverse().toArray();
    setPacks(freshPacks);

    // 加载每个包的预览图
    const imgMap: Record<number, ImageItem[]> = {};
    for (const pack of freshPacks) {
      if (pack.id) {
        const imgs = await getStylePackImages(pack.id);
        // 自愈：清理之前可能写入的坏数据（空 data 或长度异常）
        const valid = imgs.filter(isValidImageData);
        const invalidIds = imgs.filter(i => !isValidImageData(i)).map(i => i.id!).filter(Boolean);
        if (invalidIds.length > 0) {
          try {
            await db.images.bulkDelete(invalidIds);
            console.info(`已清理风格包 #${pack.id} 中 ${invalidIds.length} 张损坏图片`);
          } catch (e) {
            console.warn('清理损坏图片失败:', e);
          }
        }
        imgMap[pack.id] = valid;
      }
    }
    setPackImages(imgMap);
  }, []);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  // 创建新风格包
  const handleCreate = async () => {
    if (!newPackName.trim() || newPackImages.length < 3) return;

    try {
      const packId = await db.stylePacks.add({
        name: newPackName.trim(),
        description: newPackDesc.trim() || undefined,
        createdAt: new Date(),
      });

      // 将图片保存到 images 表（使用 packId 作为 projectId 关联）
      for (const img of newPackImages) {
        await db.images.add({
          projectId: STYLE_PACK_IMAGE_PROJECT_ID,
          stylePackId: packId as number,
          type: 'scene_ref', // 风格包图片存为 scene_ref 类型
          data: img.base64,
          mimeType: img.mimeType,
        });
      }

      setNewPackName('');
      setNewPackDesc('');
      setNewPackImages([]);
      setIsCreating(false);
      await loadPacks();
    } catch (error) {
      console.error('创建风格包失败:', error);
      toast.error('创建失败，请重试');
    }
  };

  // 删除风格包
  const handleDelete = async (packId: number) => {
    if (!(await confirm({ title: '删除这个风格包？', message: '删除后无法恢复', danger: true, confirmText: '删除' }))) return;

    try {
      await db.stylePacks.delete(packId);
      await deleteStylePackImages(packId);
      if (selectedPackId === packId) {
        setSelectedPackId(undefined);
      }
      await loadPacks();
    } catch (error) {
      console.error('删除风格包失败:', error);
      toast.error('删除失败，请重试');
    }
  };

  // 选中/应用风格包
  const handleSelectPack = (packId: number) => {
    if (selectedPackId === packId) {
      // 取消选中
      setSelectedPackId(undefined);
      onApply?.([]);
      return;
    }

    const imgs = (packImages[packId] || []).filter(isValidImageData);
    if (imgs.length === 0) {
      toast.error('该风格包没有可用的参考图，请重新创建或上传图片');
      return;
    }

    setSelectedPackId(packId);
    const compressedImgs: CompressedImage[] = imgs.map(img => ({
      base64: img.data,
      dataUrl: `data:${img.mimeType};base64,${img.data}`,
      mimeType: img.mimeType,
      size: Math.round(img.data.length / 1.37),
      originalSize: Math.round(img.data.length / 1.37),
      width: 0,
      height: 0,
    }));
    onApply?.(compressedImgs);
  };

  if (variant === 'compact') {
    return (
      <div className="bg-surface rounded-2xl border border-border-light overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="w-full flex items-center justify-between gap-2 px-5 py-4 min-h-12 hover:bg-background transition-colors"
        >
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-left min-w-0">
            <Package className="w-4 h-4 text-brand-strong" aria-hidden="true" />
            <span className="text-sm font-medium text-text-secondary">品牌风格包</span>
            <span className="text-xs text-muted bg-background px-2 py-0.5 rounded">
              {packs.length} 个
            </span>
            {selectedPackId && (
              <span className="text-xs font-semibold text-brand-strong break-all">
                已选: {packs.find(p => p.id === selectedPackId)?.name}
              </span>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 flex-shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>

        {expanded && (
          <div id={panelId} className="px-5 pb-5 pt-2 border-t border-border-light">
            <StylePackContent
              packs={packs}
              packImages={packImages}
              selectedPackId={selectedPackId}
              isCreating={isCreating}
              newPackName={newPackName}
              newPackDesc={newPackDesc}
              newPackImages={newPackImages}
              onSelectPack={handleSelectPack}
              onDelete={handleDelete}
              onStartCreate={() => setIsCreating(true)}
              onCancelCreate={() => { setIsCreating(false); setNewPackImages([]); }}
              onCreate={handleCreate}
              onNameChange={setNewPackName}
              onDescChange={setNewPackDesc}
              onImagesChange={setNewPackImages}
            />
          </div>
        )}
      </div>
    );
  }

  // inline 变体
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-strong" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-ink">品牌风格包</h3>
          <span className="text-xs text-muted">
            保存 3-5 张参考图为可复用的风格模板
          </span>
        </div>
      </div>

      <StylePackContent
        packs={packs}
        packImages={packImages}
        selectedPackId={selectedPackId}
        isCreating={isCreating}
        newPackName={newPackName}
        newPackDesc={newPackDesc}
        newPackImages={newPackImages}
        onSelectPack={handleSelectPack}
        onDelete={handleDelete}
        onStartCreate={() => setIsCreating(true)}
        onCancelCreate={() => { setIsCreating(false); setNewPackImages([]); }}
        onCreate={handleCreate}
        onNameChange={setNewPackName}
        onDescChange={setNewPackDesc}
        onImagesChange={setNewPackImages}
      />
    </div>
  );
}

// ─── 内部子组件 ───

interface StylePackContentProps {
  packs: StylePack[];
  packImages: Record<number, ImageItem[]>;
  selectedPackId?: number;
  isCreating: boolean;
  newPackName: string;
  newPackDesc: string;
  newPackImages: CompressedImage[];
  onSelectPack: (id: number) => void;
  onDelete: (id: number) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: () => void;
  onNameChange: (v: string) => void;
  onDescChange: (v: string) => void;
  onImagesChange: (v: CompressedImage[]) => void;
}

function StylePackContent({
  packs, packImages, selectedPackId,
  isCreating, newPackName, newPackDesc, newPackImages,
  onSelectPack, onDelete, onStartCreate, onCancelCreate, onCreate,
  onNameChange, onDescChange, onImagesChange,
}: StylePackContentProps) {
  const [previewPackId, setPreviewPackId] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {/* 已有风格包列表（可再点一次取消选择，所以用 aria-pressed，不是 radio） */}
      {packs.length > 0 && (
        <div role="group" aria-label="品牌风格包列表" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {packs.map((pack) => {
            const imgs = packImages[pack.id!] || [];
            const isSelected = selectedPackId === pack.id;
            const hasUsableImages = imgs.length > 0;

            return (
              <div
                key={pack.id}
                className={`
                  relative flex items-stretch gap-1 rounded-xl border transition-all duration-200
                  ${isSelected
                    ? 'border-brand-strong bg-brand-soft ring-1 ring-brand-strong shadow-sm'
                    : 'border-border hover:border-brand-strong/60 hover:bg-background'
                  }
                `}
              >
                {/* 主区域：整块可点选，是真正的 button */}
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectPack(pack.id!)}
                  className="flex flex-1 min-w-0 items-start gap-3 p-3.5 min-h-12 text-left rounded-xl"
                >
                  {/* 缩略图 */}
                  <span className="flex -space-x-2 flex-shrink-0">
                    {hasUsableImages ? (
                      imgs.slice(0, 3).map((img, i) => (
                        <span
                          key={img.id}
                          className="block w-10 h-10 rounded-lg overflow-hidden border-2 border-surface bg-background"
                          style={{ zIndex: 3 - i }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URL，next/image 无法优化 */}
                          <img
                            src={`data:${img.mimeType};base64,${img.data}`}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // 图片加载失败：用图标占位，避免破图标
                              const el = e.currentTarget;
                              el.style.display = 'none';
                              const parent = el.parentElement;
                              if (parent && !parent.querySelector('.thumb-fallback')) {
                                const span = document.createElement('span');
                                span.className = 'thumb-fallback w-full h-full flex items-center justify-center text-muted';
                                span.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="4" y1="4" x2="20" y2="20"/></svg>';
                                parent.appendChild(span);
                              }
                            }}
                          />
                        </span>
                      ))
                    ) : (
                      <span className="w-10 h-10 rounded-lg flex items-center justify-center bg-warning-soft border-2 border-surface text-warning">
                        <ImageOff className="w-4 h-4" aria-hidden="true" />
                      </span>
                    )}
                  </span>

                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-ink truncate">
                      {pack.name}
                    </span>
                    <span className="block text-xs text-text-secondary">
                      {hasUsableImages ? `${imgs.length} 张参考图` : <span className="text-warning font-medium">⚠ 无可用图，请重建</span>}
                      {pack.description && hasUsableImages && ` · ${pack.description}`}
                    </span>
                  </span>

                  {isSelected && (
                    <span className="w-5 h-5 flex-shrink-0 rounded-full bg-brand-strong flex items-center justify-center" aria-hidden="true">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </span>
                  )}
                </button>

                {/* 操作：独立按钮，触屏 40px，不再嵌在可点击卡片里 */}
                <div className="flex items-center gap-0.5 pr-2 flex-shrink-0">
                  {hasUsableImages && (
                    <button
                      type="button"
                      onClick={() => setPreviewPackId(pack.id!)}
                      className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-background text-muted hover:text-brand-strong transition-colors"
                      aria-label={`预览「${pack.name}」的所有参考图`}
                      title="预览所有参考图"
                    >
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(pack.id!)}
                    className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-danger-soft text-muted hover:text-danger transition-colors"
                    aria-label={`删除「${pack.name}」`}
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 风格包预览 */}
      {(() => {
        const pack = previewPackId !== null ? packs.find(p => p.id === previewPackId) : undefined;
        const imgs = previewPackId !== null ? (packImages[previewPackId] || []) : [];
        return (
          <Modal
            open={!!pack}
            onClose={() => setPreviewPackId(null)}
            title={pack ? <>{pack.name}<span className="ml-2 text-xs font-normal text-muted">{imgs.length} 张参考图</span></> : undefined}
            size="lg"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {imgs.map(img => (
                <div key={img.id} className="aspect-square rounded-xl overflow-hidden bg-background">
                  {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URL，next/image 无法优化 */}
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </Modal>
        );
      })()}

      {/* 无内容提示 */}
      {packs.length === 0 && !isCreating && (
        <div className="text-center py-6 text-sm text-muted">
          尚未创建风格包。保存 3-5 张参考图为品牌风格模板，后续可一键复用。
        </div>
      )}

      {/* 创建表单 */}
      {isCreating && (
        <div className="bg-background rounded-xl p-4 space-y-3 border border-border-light">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-ink">创建新风格包</h4>
            <button
              type="button"
              onClick={onCancelCreate}
              aria-label="取消创建"
              className="w-10 h-10 -mr-2 flex items-center justify-center rounded-lg hover:bg-surface transition-colors"
            >
              <X className="w-4 h-4 text-muted" aria-hidden="true" />
            </button>
          </div>

          <input
            type="text"
            value={newPackName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="风格包名称（如：春季清新系列）"
            aria-label="风格包名称"
            className="w-full text-sm border border-border rounded-lg px-3 py-2 min-h-10 bg-surface focus:outline-none focus:border-brand-strong"
          />

          <input
            type="text"
            value={newPackDesc}
            onChange={(e) => onDescChange(e.target.value)}
            placeholder="描述（可选）"
            aria-label="风格包描述（可选）"
            className="w-full text-sm border border-border rounded-lg px-3 py-2 min-h-10 bg-surface focus:outline-none focus:border-brand-strong"
          />

          <ImageUploader
            title="风格参考图"
            description="上传 3-5 张参考图，系统提取色温/光线/滤镜/氛围"
            maxFiles={5}
            images={newPackImages}
            onImagesChange={onImagesChange}
            variant="dashed"
          />

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-text-secondary" aria-live="polite">
              {newPackImages.length < 3
                ? `还需上传 ${3 - newPackImages.length} 张图片`
                : `✓ ${newPackImages.length} 张参考图`
              }
            </span>
            <button
              type="button"
              onClick={onCreate}
              disabled={!newPackName.trim() || newPackImages.length < 3}
              className={`
                text-sm font-medium px-4 py-2 min-h-10 rounded-lg transition-colors
                ${newPackName.trim() && newPackImages.length >= 3
                  ? 'bg-brand-strong text-white hover:bg-ink'
                  : 'bg-border-light text-muted cursor-not-allowed'
                }
              `}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* 创建按钮 */}
      {!isCreating && (
        <button
          type="button"
          onClick={onStartCreate}
          className="w-full flex items-center justify-center gap-2 p-3 min-h-12 rounded-xl border border-dashed border-border hover:border-brand-strong hover:bg-brand-soft text-sm text-text-secondary hover:text-brand-strong transition-all"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          创建新风格包
        </button>
      )}
    </div>
  );
}
