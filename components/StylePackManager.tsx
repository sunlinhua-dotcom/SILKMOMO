'use client';

import { useState, useEffect, useCallback } from 'react';
import { db, type ImageItem } from '@/lib/db';
import { ImageUploader } from './ImageUploader';
import type { CompressedImage } from '@/lib/image-compressor';
import { Plus, Package, Trash2, Check, X, ChevronDown } from 'lucide-react';

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

  const loadPacks = useCallback(async () => {
    const allPacks = await db.stylePacks.orderBy('createdAt').reverse().toArray();
    
    // 如果没有任何风格包，且没有初始化过，则自动加载预置的高定图片
    if (allPacks.length === 0 && !localStorage.getItem('luxury_pack_init')) {
      try {
        const urls = ['/presets/luxury/deiji.jpg', '/presets/luxury/eberjey.jpg'];
        const base64Images: { base64: string; mimeType: string }[] = [];
        for (const url of urls) {
          const res = await fetch(url);
          const blob = await res.blob();
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          const rawBase64 = base64.split(',')[1];
          base64Images.push({ base64: rawBase64, mimeType: blob.type });
        }

        const packId = await db.stylePacks.add({
          name: 'SILKMOMO高定美学 (默认)',
          description: '基于 Deiji Studios / Eberjey 预设',
          createdAt: new Date(),
        });

        for (const img of base64Images) {
          await db.images.add({
            projectId: packId,
            type: 'scene_ref',
            data: img.base64,
            mimeType: img.mimeType,
          });
        }
        localStorage.setItem('luxury_pack_init', 'true');
        
        // 重新查询
        const freshPacks = await db.stylePacks.orderBy('createdAt').reverse().toArray();
        setPacks(freshPacks);
        const imgMap: Record<number, ImageItem[]> = {};
        for (const pack of freshPacks) {
          if (pack.id) {
            imgMap[pack.id] = await db.images.where('projectId').equals(pack.id).toArray();
          }
        }
        setPackImages(imgMap);
        return;
      } catch (err) {
        console.error('Failed to auto init luxury pack:', err);
      }
    }

    setPacks(allPacks);

    // 加载每个包的预览图
    const imgMap: Record<number, ImageItem[]> = {};
    for (const pack of allPacks) {
      if (pack.id) {
        const imgs = await db.images.where('projectId').equals(pack.id).toArray();
        imgMap[pack.id] = imgs;
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
          projectId: packId as number,
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
      alert('创建失败，请重试');
    }
  };

  // 删除风格包
  const handleDelete = async (packId: number) => {
    if (!confirm('确定删除此风格包？')) return;

    try {
      await db.stylePacks.delete(packId);
      await db.images.where('projectId').equals(packId).delete();
      if (selectedPackId === packId) {
        setSelectedPackId(undefined);
      }
      await loadPacks();
    } catch (error) {
      console.error('删除风格包失败:', error);
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

    setSelectedPackId(packId);
    const imgs = packImages[packId] || [];
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
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border-light)] overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--color-background)] transition-colors"
        >
          <div className="flex items-center gap-3">
            <Package className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">品牌风格包</span>
            <span className="text-xs text-[var(--color-text-muted)] bg-[var(--color-background)] px-2 py-0.5 rounded">
              {packs.length} 个
            </span>
            {selectedPackId && (
              <span className="text-xs font-semibold text-[var(--color-accent)]">
                已选: {packs.find(p => p.id === selectedPackId)?.name}
              </span>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <div className="px-5 pb-5 pt-2 border-t border-[var(--color-border-light)]">
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
          <Package className="w-4 h-4 text-[var(--color-accent)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">品牌风格包</h3>
          <span className="text-xs text-[var(--color-text-muted)]">
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
  return (
    <div className="space-y-3">
      {/* 已有风格包列表 */}
      {packs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {packs.map((pack) => {
            const imgs = packImages[pack.id!] || [];
            const isSelected = selectedPackId === pack.id;

            return (
              <div
                key={pack.id}
                className={`
                  relative flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200
                  ${isSelected
                    ? 'border-[var(--color-accent)] bg-[rgba(201,168,108,0.06)] shadow-sm'
                    : 'border-[var(--color-border-light)] hover:border-[var(--color-border)] hover:bg-[var(--color-background)]'
                  }
                `}
                onClick={() => onSelectPack(pack.id!)}
              >
                {/* 缩略图 */}
                <div className="flex -space-x-2 flex-shrink-0">
                  {imgs.slice(0, 3).map((img, i) => (
                    <div
                      key={img.id}
                      className="w-10 h-10 rounded-lg overflow-hidden border-2 border-[var(--color-surface)]"
                      style={{ zIndex: 3 - i }}
                    >
                      <img
                        src={`data:${img.mimeType};base64,${img.data}`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {pack.name}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {imgs.length} 张参考图
                    {pack.description && ` · ${pack.description}`}
                  </div>
                </div>

                {/* 操作 */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(pack.id!); }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 无内容提示 */}
      {packs.length === 0 && !isCreating && (
        <div className="text-center py-6 text-sm text-[var(--color-text-muted)]">
          尚未创建风格包。保存 3-5 张参考图为品牌风格模板，后续可一键复用。
        </div>
      )}

      {/* 创建表单 */}
      {isCreating && (
        <div className="bg-[var(--color-background)] rounded-xl p-4 space-y-3 border border-[var(--color-border-light)]">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-[var(--color-text)]">创建新风格包</h4>
            <button
              onClick={onCancelCreate}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-surface)] transition-colors"
            >
              <X className="w-4 h-4 text-[var(--color-text-muted)]" />
            </button>
          </div>

          <input
            type="text"
            value={newPackName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="风格包名称（如：春季清新系列）"
            className="w-full text-sm border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
          />

          <input
            type="text"
            value={newPackDesc}
            onChange={(e) => onDescChange(e.target.value)}
            placeholder="描述（可选）"
            className="w-full text-sm border border-[var(--color-border-light)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:border-[var(--color-accent)]"
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
            <span className="text-xs text-[var(--color-text-muted)]">
              {newPackImages.length < 3
                ? `还需上传 ${3 - newPackImages.length} 张图片`
                : `✓ ${newPackImages.length} 张参考图`
              }
            </span>
            <button
              onClick={onCreate}
              disabled={!newPackName.trim() || newPackImages.length < 3}
              className={`
                text-sm font-medium px-4 py-1.5 rounded-lg transition-colors
                ${newPackName.trim() && newPackImages.length >= 3
                  ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-dark)]'
                  : 'bg-[var(--color-border-light)] text-[var(--color-text-muted)] cursor-not-allowed'
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
          onClick={onStartCreate}
          className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[rgba(201,168,108,0.03)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-all"
        >
          <Plus className="w-4 h-4" />
          创建新风格包
        </button>
      )}
    </div>
  );
}
