'use client';

// ===== [D] 脸库面板（ModelFaceLibraryPanel） =====
// 0906 板块拆分：本文件整段从 app/lookbook/page.tsx 搬出，JSX、类名、文案、常量数值
// 一字未改。三个 interface 与两个常量原先也定义在那个页面里，跟着组件一起搬过来并
// 导出，页面改成从这里 import，避免同一份类型两处各写一遍。

import { Pencil, Star, Trash2 } from 'lucide-react';
import { getGenerationCostFen } from '@/lib/billing-constants';

export const MODEL_FACE_BATCH_SIZE = 3;
const MODEL_FACE_PRICE_FEN = getGenerationCostFen('openai', 'medium');

export interface ModelFaceRecord {
  id: string;
  thumbnail: string | null;
  recipeLabel: string;
  favorite: boolean;
  name: string;
  createdAt: string;
}

export interface ModelFacePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ModelFaceJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  error?: string | null;
  items: Array<{ id: string; status: string; error?: string | null }>;
}

export function ModelFaceLibraryPanel({
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
  pagination,
  onPageChange,
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
  pagination: ModelFacePagination;
  onPageChange: (page: number) => void;
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
                  src={face.thumbnail
                    ? `data:image/jpeg;base64,${face.thumbnail}`
                    : `/api/model-faces/${face.id}?variant=thumbnail`}
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

      {pagination.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
            className="disabled:opacity-40"
          >
            上一页
          </button>
          <span>{pagination.page}/{pagination.totalPages} · 共 {pagination.total} 张</span>
          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
            className="disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}

      {job && loading && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          正在生成 {job.completedCount + job.failedCount}/{job.requestedCount}；可离开页面，回来后会自动接上。
        </p>
      )}
      {job?.status === 'failed' && job.items.some(item => ['pending', 'running'].includes(item.status)) && (
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
