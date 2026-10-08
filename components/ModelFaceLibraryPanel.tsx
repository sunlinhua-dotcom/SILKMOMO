'use client';

// ===== [D] 脸库面板（ModelFaceLibraryPanel） =====
// 0906 板块拆分：本文件整段从 app/lookbook/page.tsx 搬出。三个 interface 与两个常量原先
// 也定义在那个页面里，跟着组件一起搬过来并导出，页面改成从这里 import。
// 1008：操作按钮点击区 ≥40px 并移到缩略图下方、补 aria；命名改 Modal 输入框，删除改 useConfirm。
// 1008 T5：「继续生成」先 useConfirm 写清张数与金额（价格取任务自带 costFen + 未扣费条目数，不硬编码），按钮标价。

import { useMemo, useRef, useState } from 'react';
import { Pencil, Star, Trash2 } from 'lucide-react';
import { getGenerationCostFen } from '@/lib/billing-constants';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmDialog';

export const MODEL_FACE_BATCH_SIZE = 3;
// 与服务端 lib/model-face-jobs.ts 的 MODEL_FACE_PRICE_FEN 同源（同一个 getGenerationCostFen 调用）
export const MODEL_FACE_PRICE_FEN = getGenerationCostFen('openai', 'medium');
// 与 PATCH /api/model-faces/[id] 的 name.slice(0, 40) 对齐
const MODEL_FACE_NAME_MAX = 40;

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
  /** 服务端任务行自带的单张价格（分）；缺失时回退 MODEL_FACE_PRICE_FEN */
  costFen?: number;
  /** billingStatus === 'uncharged' 才会在继续时扣费；其余（charged / kept / refund_pending）不会重复扣款 */
  items: Array<{ id: string; status: string; billingStatus?: string; error?: string | null }>;
}

const ACTION_BTN_BASE =
  'flex h-10 min-w-10 flex-1 items-center justify-center rounded-lg border bg-[var(--color-surface)] transition-colors focus-visible:ring-2 focus-visible:ring-brand-strong';
const ACTION_BTN = `${ACTION_BTN_BASE} border-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:text-[var(--color-text)]`;
const ACTION_BTN_DANGER = `${ACTION_BTN_BASE} border-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:border-danger hover:text-danger`;

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
  const confirm = useConfirm();
  const batchCostFen = MODEL_FACE_PRICE_FEN * MODEL_FACE_BATCH_SIZE;
  const resumeLockRef = useRef(false);
  const resumeQuote = useMemo(() => {
    const remaining = (job?.items ?? []).filter(item => item.status === 'pending' || item.status === 'running');
    // 没带 billingStatus 的旧数据按"未扣费"算，宁可多报也不少报
    const uncharged = remaining.filter(item => (item.billingStatus ?? 'uncharged') === 'uncharged').length;
    const unitFen = job?.costFen ?? MODEL_FACE_PRICE_FEN;
    return { count: remaining.length, uncharged, totalFen: uncharged * unitFen };
  }, [job]);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const faceLabel = (face: ModelFaceRecord, index: number) => face.name || `御用模特脸 ${index + 1}`;

  const submitRename = async () => {
    if (!renaming || renameSaving) return;
    setRenameSaving(true);
    try {
      await onUpdate(renaming.id, { name: renaming.name.trim() });
      setRenaming(null);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async (face: ModelFaceRecord, index: number) => {
    const ok = await confirm({
      title: '从御用脸库删除这张脸？',
      message: `「${faceLabel(face, index)}」删除后无法恢复。`,
      danger: true,
      confirmText: '删除',
    });
    if (ok) await onDelete(face.id);
  };

  const handleResume = async () => {
    if (resumeLockRef.current) return;
    resumeLockRef.current = true;
    try {
      const { count, uncharged, totalFen } = resumeQuote;
      const already = count - uncharged;
      const ok = await confirm({
        title: '继续生成模特脸？',
        message: totalFen > 0
          ? `将生成 ${count} 张 · 共 ¥${(totalFen / 100).toFixed(2)}，从账户余额扣除。${already > 0 ? `其中 ${already} 张此前已扣费，不会重复扣款。` : ''}`
          : `将生成 ${count} 张 · 共 ¥0.00。这 ${count} 张此前已扣费，不会重复扣款。`,
        confirmText: '确认继续',
      });
      if (ok) onResume();
    } finally {
      resumeLockRef.current = false;
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">御用 AI 模特脸库</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">
            每次增量生成 {MODEL_FACE_BATCH_SIZE} 张，按账号保存并跨设备同步。点星标设为御用；不手选时优先随机使用御用脸。每张 ¥{(MODEL_FACE_PRICE_FEN / 100).toFixed(2)}。
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading || balanceFen === null || balanceFen < batchCostFen}
          className="shrink-0 min-h-10 text-xs px-3 rounded-lg border border-brand-strong text-brand-strong disabled:opacity-50"
        >
          {loading ? '生成中…' : <>再出 3 张 · <span className="num">¥{(batchCostFen / 100).toFixed(2)}</span></>}
        </button>
      </div>

      {faces.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] px-4 py-6 text-center">
          <p className="text-sm text-[var(--color-text)]">脸库还是空的</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            点右上角「再出 {MODEL_FACE_BATCH_SIZE} 张」生成第一批虚构模特脸；选定一张后，整组图都会使用同一位模特。
          </p>
        </div>
      )}

      {faces.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {faces.map((face, index) => {
            const label = faceLabel(face, index);
            const chosen = chosenFaceId === face.id;
            return (
              <div key={face.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onChoose(chosen ? null : face.id)}
                  aria-pressed={chosen}
                  aria-label={`${chosen ? '取消选用' : '选用'}：${label}`}
                  className={`relative w-full aspect-[3/4] rounded-lg overflow-hidden border-2 transition focus-visible:ring-2 focus-visible:ring-brand-strong ${
                    chosen
                      ? 'border-brand-strong ring-2 ring-brand-strong/30'
                      : 'border-transparent hover:border-[var(--color-border-light)]'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={face.thumbnail
                      ? `data:image/jpeg;base64,${face.thumbnail}`
                      : `/api/model-faces/${face.id}?variant=thumbnail`}
                    alt={label}
                    className="w-full h-full object-cover"
                  />
                </button>
                <p className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]">
                  {face.name || face.recipeLabel}
                </p>
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    aria-label={face.favorite ? `取消御用：${label}` : `设为御用：${label}`}
                    aria-pressed={face.favorite}
                    title={face.favorite ? '取消御用' : '设为御用'}
                    onClick={() => void onUpdate(face.id, { favorite: !face.favorite })}
                    className={`${ACTION_BTN} ${face.favorite ? 'text-brand-strong' : ''}`}
                  >
                    <Star size={16} fill={face.favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`命名：${label}`}
                    title="命名"
                    onClick={() => setRenaming({ id: face.id, name: face.name })}
                    className={ACTION_BTN}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除：${label}`}
                    title="删除"
                    onClick={() => void handleDelete(face, index)}
                    className={ACTION_BTN_DANGER}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
            className="min-h-10 px-3 rounded-lg disabled:opacity-40"
          >
            上一页
          </button>
          <span className="num text-center">{pagination.page}/{pagination.totalPages} · 共 {pagination.total} 张</span>
          <button
            type="button"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
            className="min-h-10 px-3 rounded-lg disabled:opacity-40"
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
          onClick={() => void handleResume()}
          className="mt-2 min-h-10 text-xs text-brand-strong underline underline-offset-2"
        >
          继续生成 · {resumeQuote.count} 张 · <span className="num">{resumeQuote.totalFen > 0 ? `¥${(resumeQuote.totalFen / 100).toFixed(2)}` : '不再扣费'}</span>
        </button>
      )}
      {balanceFen !== null && balanceFen < batchCostFen && (
        <p className="mt-2 text-xs text-warning">余额不足，生成 {MODEL_FACE_BATCH_SIZE} 张需要 <span className="num">¥{(batchCostFen / 100).toFixed(2)}</span>。</p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {chosenFaceId !== null && (
        <p className="mt-2 text-xs text-brand-strong">
          已选中这张完整身份锚，整组图都会使用同一位虚构模特。再点一次可取消。
        </p>
      )}

      <Modal
        open={renaming !== null}
        onClose={() => { if (!renameSaving) setRenaming(null); }}
        title="给这张御用脸命名"
        size="sm"
        initialFocusRef={renameInputRef}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setRenaming(null)}
              disabled={renameSaving}
              className="min-h-10 rounded-xl border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              form="model-face-rename-form"
              disabled={renameSaving}
              className="min-h-10 rounded-xl bg-brand-strong px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              {renameSaving ? '保存中…' : '保存'}
            </button>
          </>
        )}
      >
        <form
          id="model-face-rename-form"
          onSubmit={(e) => { e.preventDefault(); void submitRename(); }}
        >
          <label htmlFor="model-face-rename-input" className="mb-2 block text-xs text-[var(--color-text-muted)]">
            名称（最多 {MODEL_FACE_NAME_MAX} 字，留空则恢复默认）
          </label>
          <input
            id="model-face-rename-input"
            ref={renameInputRef}
            type="text"
            value={renaming?.name ?? ''}
            maxLength={MODEL_FACE_NAME_MAX}
            onChange={(e) => setRenaming(cur => cur ? { ...cur, name: e.target.value } : cur)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:outline-none focus:border-brand-strong"
          />
        </form>
      </Modal>
    </div>
  );
}
