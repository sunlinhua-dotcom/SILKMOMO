'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Loader, Expand, Wand2, X, Check, RotateCcw } from 'lucide-react';
import { ImageLightbox } from './ImageLightbox';
import { useToast } from './ui/Toast';

interface ResultImage {
  id: number;
  type: string;
  imageType: 'hero' | 'full_body' | 'half_body' | 'close_up';
  data: string;
  prompt?: string;
  index?: number;
  backup?: {
    id: number;
    data: string;
  };
}

interface ResultGalleryProps {
  images: ResultImage[];
  onRegenerate?: (imageId: number, customPrompt?: string) => void;
  onAcceptNewVersion?: (imageId: number) => void;
  onRejectNewVersion?: (imageId: number) => void;
}

type ImageType = ResultImage['imageType'];

const IMAGE_LABELS: Record<string, string> = {
  hero: '头图',
  full_body: '全身照',
  half_body: '半身照',
  close_up: '特写'
};

const IMAGE_TYPE_ORDER = ['hero', 'full_body', 'half_body', 'close_up'];

// 不同 imageType 实际生成尺寸不同，用对应的 aspect-ratio 避免 object-cover 切边
function aspectClassFor(imageType: ImageType): string {
  if (imageType === 'full_body' || imageType === 'half_body') return 'aspect-[3/4]'; // 竖图
  if (imageType === 'hero') return 'aspect-video';                                    // 16:9 场景图
  return 'aspect-square';                                                             // close_up 特写
}

// 与 aspect 对应的 intrinsic 尺寸，给 <img> 的 width/height 用（容器已锁比例，这里只防图片自身布局跳动）
function intrinsicSizeFor(imageType: ImageType): { width: number; height: number } {
  if (imageType === 'full_body' || imageType === 'half_body') return { width: 768, height: 1024 };
  if (imageType === 'hero') return { width: 1280, height: 720 };
  return { width: 1024, height: 1024 };
}

const dataUri = (b64: string) => `data:image/png;base64,${b64}`;

// ── 公共样式 ──
const ROW_BTN =
  'flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 min-h-10 rounded-lg text-sm border border-border-light bg-surface text-ink hover:bg-brand-strong hover:text-surface hover:border-transparent transition-colors disabled:opacity-50';
const ROUND_BTN =
  'w-11 h-11 flex items-center justify-center bg-surface text-ink rounded-full shadow-lg hover:bg-brand-strong hover:text-surface transition-colors disabled:opacity-50';
const TIP =
  'pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] px-2.5 py-1 rounded-md bg-ink/90 text-surface opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 transition-opacity duration-150 z-10';
// 操作栏：悬停设备 hover / 键盘 focus-within 时出现；触屏（hover:none）常显
const BAR_VISIBLE =
  'group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto';

// ───────── 微调输入面板（自带文本 state，打字不会让整个图库重渲） ─────────
const AdjustPanel = memo(function AdjustPanel({
  id,
  variant,
  busy,
  onSubmit,
  onCancel
}: {
  id: number;
  variant: 'row' | 'tile';
  busy: boolean;
  onSubmit: (id: number, text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  return (
    <div
      role="group"
      aria-label="描述要调整什么"
      className={
        variant === 'tile'
          ? 'absolute inset-x-3 bottom-3 bg-surface rounded-2xl shadow-2xl p-3 z-30'
          : 'bg-background rounded-xl p-3'
      }
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-medium text-text-secondary">描述要调整什么</p>
        <button
          type="button"
          onClick={onCancel}
          className="-mr-2 -mt-2 w-10 h-10 rounded-lg hover:bg-background flex items-center justify-center"
          aria-label="取消微调"
        >
          <X className="w-4 h-4 text-muted" />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        aria-label="调整描述"
        autoFocus
        rows={variant === 'tile' ? 3 : 2}
        placeholder="例：模特表情更柔和、整体提亮、背景改成米色窗帘"
        maxLength={500}
        className="w-full text-xs px-2.5 py-1.5 border border-border-light rounded-lg focus:outline-none focus:border-brand-strong resize-none text-ink bg-surface"
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-muted num">{text.length}/500</span>
        <button
          type="button"
          onClick={() => { if (trimmed) onSubmit(id, trimmed); }}
          disabled={!trimmed || busy}
          className="text-xs font-medium px-3 min-h-10 rounded-lg bg-brand-strong text-surface hover:bg-primary disabled:bg-border-light disabled:text-muted transition-colors"
        >
          按描述重做
        </button>
      </div>
    </div>
  );
});

// ───────── 图库内部动作集合（引用稳定，传给子项不会让它们重渲） ─────────
interface GalleryActions {
  open: (key: string) => void;
  download: (id: number, old?: boolean) => void;
  regenerate: (id: number) => void;
  startAdjust: (id: number) => void;
  submitAdjust: (id: number, text: string) => void;
  cancelAdjust: () => void;
  accept: (id: number) => void;
  reject: (id: number) => void;
}

// ───────── 网格卡片 ─────────
const GalleryTile = memo(function GalleryTile({
  id,
  imageType,
  data,
  isRegen,
  isAdjusting,
  canRegenerate,
  actions
}: {
  id: number;
  imageType: ImageType;
  data: string;
  isRegen: boolean;
  isAdjusting: boolean;
  canRegenerate: boolean;
  actions: GalleryActions;
}) {
  const label = IMAGE_LABELS[imageType];
  const size = intrinsicSizeFor(imageType);
  return (
    <div
      className={`group relative ${aspectClassFor(imageType)} rounded-2xl overflow-hidden bg-background hover-lift`}
      aria-busy={isRegen || undefined}
    >
      <button
        type="button"
        data-view-key={String(id)}
        onClick={() => actions.open(String(id))}
        disabled={isRegen}
        className="block w-full h-full cursor-pointer focus-visible:-outline-offset-4"
        aria-label={`查看大图：${label}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data:/base64 内存图，next/image 无法优化 */}
        <img
          src={dataUri(data)}
          alt={label}
          width={size.width}
          height={size.height}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-contain"
        />
      </button>

      {/* 重做中遮罩 */}
      {isRegen && (
        <div role="status" className="absolute inset-0 bg-ink/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 z-20 animate-fade-in">
          <Loader className="w-10 h-10 text-surface animate-spin" strokeWidth={1.5} />
          <span className="text-sm text-surface font-medium tracking-wide">重做中…</span>
          <span className="text-[10px] text-surface/70">完成后将自动替换</span>
        </div>
      )}

      {/* 图片标签 */}
      <div className="absolute top-3 left-3 pointer-events-none">
        <span className="px-2.5 py-1 text-xs font-medium bg-surface/90 backdrop-blur-sm rounded-full text-ink shadow-sm">
          {label}
        </span>
      </div>

      {/* 操作栏：渐变底只是装饰（不拦截点击），按钮组 hover / focus-within 显示，触屏常显 */}
      {!isAdjusting && !isRegen && (
        <>
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink/70 to-transparent transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`}
          />
          <div
            className={`absolute inset-x-0 bottom-0 z-20 flex justify-center gap-2 pb-3 transition-opacity opacity-0 pointer-events-none ${BAR_VISIBLE}`}
          >
            <div className="relative group/tip">
              <button type="button" onClick={() => actions.download(id)} className={ROUND_BTN} aria-label="下载图片">
                <Download className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <span aria-hidden="true" className={TIP}>下载</span>
            </div>
            {canRegenerate && (
              <>
                <div className="relative group/tip">
                  <button type="button" onClick={() => actions.regenerate(id)} className={ROUND_BTN} aria-label="重新生成（用相同参数）">
                    <RefreshCw className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                  <span aria-hidden="true" className={TIP}>重新生成</span>
                </div>
                <div className="relative group/tip">
                  <button type="button" onClick={() => actions.startAdjust(id)} className={ROUND_BTN} aria-label="描述要调整什么">
                    <Wand2 className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                  <span aria-hidden="true" className={TIP}>微调描述</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* "描述调整"输入面板 */}
      {isAdjusting && (
        <AdjustPanel id={id} variant="tile" busy={isRegen} onSubmit={actions.submitAdjust} onCancel={actions.cancelAdjust} />
      )}
    </div>
  );
});

// ───────── 对比行：旧版 ｜ 新版（在右）｜ 右侧操作面板 ─────────
const CompareRow = memo(function CompareRow({
  id,
  imageType,
  data,
  backupData,
  isRegen,
  isAdjusting,
  canRegenerate,
  actions
}: {
  id: number;
  imageType: ImageType;
  data: string;
  backupData: string;
  isRegen: boolean;
  isAdjusting: boolean;
  canRegenerate: boolean;
  actions: GalleryActions;
}) {
  const aspectClass = aspectClassFor(imageType);
  const size = intrinsicSizeFor(imageType);
  const label = IMAGE_LABELS[imageType];

  return (
    <div className="rounded-2xl border border-border-light bg-surface p-3 sm:p-4 space-y-3 animate-fade-in">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        {/* 旧版 */}
        <div className="relative flex-1 min-w-0">
          <span className="absolute top-2 left-2 z-10 px-2 py-0.5 text-[11px] font-medium bg-surface/90 backdrop-blur-sm rounded-full text-text-secondary shadow-sm pointer-events-none">
            旧版
          </span>
          <button
            type="button"
            data-view-key={`${id}:old`}
            onClick={() => actions.open(`${id}:old`)}
            className={`block w-full ${aspectClass} rounded-xl overflow-hidden bg-background cursor-pointer focus-visible:-outline-offset-4`}
            aria-label={`查看旧版大图：${label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- data:/base64 内存图，next/image 无法优化 */}
            <img
              src={dataUri(backupData)}
              alt="旧版"
              width={size.width}
              height={size.height}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain"
            />
          </button>
        </div>

        {/* 新版（在右） */}
        <div className="relative flex-1 min-w-0">
          <span className="absolute top-2 left-2 z-10 px-2 py-0.5 text-[11px] font-medium bg-brand-strong rounded-full text-surface shadow-sm pointer-events-none">
            新版
          </span>
          <div className={`relative ${aspectClass} rounded-xl overflow-hidden bg-background`} aria-busy={isRegen || undefined}>
            <button
              type="button"
              data-view-key={String(id)}
              onClick={() => actions.open(String(id))}
              disabled={isRegen}
              className="block w-full h-full cursor-pointer focus-visible:-outline-offset-4"
              aria-label={`查看新版大图：${label}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- data:/base64 内存图，next/image 无法优化 */}
              <img
                src={dataUri(data)}
                alt="新版"
                width={size.width}
                height={size.height}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-contain"
              />
            </button>
            {isRegen && (
              <div role="status" className="absolute inset-0 bg-ink/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-20 animate-fade-in">
                <Loader className="w-8 h-8 text-surface animate-spin" strokeWidth={1.5} />
                <span className="text-xs text-surface font-medium tracking-wide">重做中…</span>
              </div>
            )}
          </div>
        </div>

        {/* 右侧操作面板 */}
        <div className="flex flex-row flex-wrap sm:flex-col gap-2 sm:w-44 flex-shrink-0">
          <button type="button" onClick={() => actions.download(id)} className={ROW_BTN}>
            <Download className="w-4 h-4" strokeWidth={1.5} />
            下载新版
          </button>
          {canRegenerate && (
            <>
              <button type="button" onClick={() => actions.regenerate(id)} disabled={isRegen} className={ROW_BTN}>
                {isRegen ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" strokeWidth={1.5} />}
                重新生成
              </button>
              <button type="button" onClick={() => actions.startAdjust(id)} disabled={isRegen} className={ROW_BTN}>
                <Wand2 className="w-4 h-4" strokeWidth={1.5} />
                微调描述
              </button>
            </>
          )}
          <div className="hidden sm:block h-px bg-border-light my-1" />
          <button
            type="button"
            onClick={() => actions.reject(id)}
            disabled={isRegen}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 min-h-10 rounded-lg text-sm font-medium border border-danger/30 text-danger hover:bg-danger-soft transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" strokeWidth={1.5} />
            还原旧版
          </button>
          <button
            type="button"
            onClick={() => actions.accept(id)}
            disabled={isRegen}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 min-h-10 rounded-lg text-sm font-medium bg-brand-strong text-surface hover:bg-primary transition-colors disabled:opacity-50"
          >
            <Check className="w-4 h-4" strokeWidth={1.5} />
            保留新版
          </button>
        </div>
      </div>

      {/* 微调描述输入 */}
      {isAdjusting && (
        <AdjustPanel id={id} variant="row" busy={isRegen} onSubmit={actions.submitAdjust} onCancel={actions.cancelAdjust} />
      )}
    </div>
  );
});

// 灯箱里可翻页的条目（按页面展示顺序：每组先对比行的旧版/新版，再常规网格）
interface ViewItem {
  key: string; // `${id}` 新版/常规；`${id}:old` 旧版
  id: number;
  imageType: ImageType;
  data: string;
  isOld: boolean;
}

function ResultGalleryImpl({
  images,
  onRegenerate,
  onAcceptNewVersion,
  onRejectNewVersion
}: ResultGalleryProps) {
  const toast = useToast();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<Set<number>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);
  // 哪张图正在弹"调整描述"输入框
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 最新 props 放 ref：actions 引用保持稳定，子项不因父组件传新函数而全量重渲
  const latest = useRef({ images, onRegenerate, onAcceptNewVersion, onRejectNewVersion });
  useEffect(() => {
    latest.current = { images, onRegenerate, onAcceptNewVersion, onRejectNewVersion };
  });

  const downloadImage = useCallback((id: number, old = false) => {
    const image = latest.current.images.find((i) => i.id === id);
    if (!image) return;
    const data = old ? image.backup?.data : image.data;
    if (!data) return;
    const link = document.createElement('a');
    link.href = dataUri(data);
    link.download = `silxine-${image.imageType}-${image.index || 1}${old ? '-old' : ''}.png`;
    link.click();
  }, []);

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      // 打包库只在点击「下载全部」时才加载，不进首包
      const [{ default: JSZip }, { saveAs }] = await Promise.all([import('jszip'), import('file-saver')]);
      const zip = new JSZip();
      // 同 shotIndex 的新旧版本会生成相同文件名，JSZip 同名后写覆盖先写 → 静默丢图。
      // 重名时追加图片 id 保证唯一。
      const usedNames = new Set<string>();
      images.forEach((img) => {
        const imageData = atob(img.data);
        const array = new Uint8Array(imageData.length);
        for (let i = 0; i < imageData.length; i++) {
          array[i] = imageData.charCodeAt(i);
        }
        let name = `silxine-${img.imageType}-${img.index || 1}.png`;
        if (usedNames.has(name)) {
          name = `silxine-${img.imageType}-${img.index || 1}-${img.id}.png`;
        }
        usedNames.add(name);
        zip.file(name, array);
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'silxine-images.zip');
    } catch (err) {
      console.error('[ResultGallery] 打包下载失败', err);
      toast.error('打包下载失败，请重试');
    } finally {
      setDownloadingAll(false);
    }
  };

  const regenerate = useCallback(async (id: number, customPrompt?: string) => {
    const fn = latest.current.onRegenerate;
    if (!fn) return;
    setRegenerating((prev) => new Set(prev).add(id));
    setAdjustingId(null);
    try {
      await fn(id, customPrompt);
    } finally {
      setRegenerating((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const actions = useMemo<GalleryActions>(
    () => ({
      open: setSelectedKey,
      download: downloadImage,
      regenerate: (id) => { void regenerate(id); },
      startAdjust: setAdjustingId,
      submitAdjust: (id, text) => { void regenerate(id, text); },
      cancelAdjust: () => setAdjustingId(null),
      accept: (id) => latest.current.onAcceptNewVersion?.(id),
      reject: (id) => latest.current.onRejectNewVersion?.(id)
    }),
    [downloadImage, regenerate]
  );

  // 展示顺序的条目表，供灯箱翻页
  const viewItems = useMemo<ViewItem[]>(() => {
    const list: ViewItem[] = [];
    for (const type of IMAGE_TYPE_ORDER) {
      const typeImages = images.filter((img) => img.imageType === type);
      for (const img of typeImages.filter((i) => i.backup)) {
        list.push({ key: `${img.id}:old`, id: img.id, imageType: img.imageType, data: img.backup!.data, isOld: true });
        list.push({ key: String(img.id), id: img.id, imageType: img.imageType, data: img.data, isOld: false });
      }
      for (const img of typeImages.filter((i) => !i.backup)) {
        list.push({ key: String(img.id), id: img.id, imageType: img.imageType, data: img.data, isOld: false });
      }
    }
    return list;
  }, [images]);

  const selectedIdx = selectedKey === null ? -1 : viewItems.findIndex((v) => v.key === selectedKey);
  const selected = selectedIdx >= 0 ? viewItems[selectedIdx] : null;

  const closeLightbox = useCallback(() => {
    const key = selectedKey;
    setSelectedKey(null);
    if (key === null) return;
    // 灯箱自己会把焦点还给打开时的元素；翻页后当前图可能不是打开的那张，等它卸载后再把焦点交给当前图的缩略图
    requestAnimationFrame(() => {
      const trigger = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-view-key]') ?? []).find(
        (el) => el.dataset.viewKey === key
      );
      trigger?.focus();
    });
  }, [selectedKey]);

  if (images.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 rounded-full bg-background flex items-center justify-center mx-auto mb-4">
          <Expand className="w-8 h-8 text-muted" />
        </div>
        <p className="text-text-secondary">暂无生成结果</p>
        <p className="text-sm text-muted mt-2">
          完成生成后，图片将在这里显示
        </p>
      </div>
    );
  }

  const canRegenerate = !!onRegenerate;

  return (
    <div ref={rootRef} className="space-y-8">
      {/* 下载按钮 */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleDownloadAll}
          disabled={downloadingAll}
          className="btn-primary text-sm px-5 py-2.5 min-h-11"
        >
          {downloadingAll ? (
            <>
              <Loader className="w-5 h-5 animate-spin" />
              <span>打包中...</span>
            </>
          ) : (
            <>
              <Download className="w-5 h-5" strokeWidth={1.5} />
              <span>下载全部 (<span className="num">{images.length}</span>张)</span>
            </>
          )}
        </button>
      </div>

      {/* 图片分组展示 */}
      {IMAGE_TYPE_ORDER.map((type) => {
        const typeImages = images.filter(img => img.imageType === type);
        if (typeImages.length === 0) return null;

        // 有旧版备份的图 → 整行「旧版 | 新版 | 右侧面板」对比；其余 → 常规网格
        const comparing = typeImages.filter(img => !!img.backup);
        const normal = typeImages.filter(img => !img.backup);

        return (
          <div key={type} className="space-y-4">
            <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
              {IMAGE_LABELS[type]}
            </h3>

            {comparing.map((image) => (
              <CompareRow
                key={image.id}
                id={image.id}
                imageType={image.imageType}
                data={image.data}
                backupData={image.backup!.data}
                isRegen={regenerating.has(image.id)}
                isAdjusting={adjustingId === image.id}
                canRegenerate={canRegenerate}
                actions={actions}
              />
            ))}

            {normal.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 min-w-0">
                {normal.map((image) => (
                  <GalleryTile
                    key={image.id}
                    id={image.id}
                    imageType={image.imageType}
                    data={image.data}
                    isRegen={regenerating.has(image.id)}
                    isAdjusting={adjustingId === image.id}
                    canRegenerate={canRegenerate}
                    actions={actions}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {selected && (
        <ImageLightbox
          src={dataUri(selected.data)}
          alt={`${IMAGE_LABELS[selected.imageType]}${selected.isOld ? '（旧版）' : ''}预览`}
          caption={`${IMAGE_LABELS[selected.imageType]}${selected.isOld ? ' · 旧版' : ''} · ${selectedIdx + 1} / ${viewItems.length}`}
          onClose={closeLightbox}
          onPrev={selectedIdx > 0 ? () => setSelectedKey(viewItems[selectedIdx - 1].key) : undefined}
          onNext={selectedIdx < viewItems.length - 1 ? () => setSelectedKey(viewItems[selectedIdx + 1].key) : undefined}
          busy={regenerating.has(selected.id)}
          onRegenerate={
            canRegenerate && !selected.isOld
              ? () => { setSelectedKey(null); void regenerate(selected.id); }
              : undefined
          }
          onAdjust={
            canRegenerate && !selected.isOld
              ? () => { setSelectedKey(null); setAdjustingId(selected.id); }
              : undefined
          }
          footer={
            <button
              type="button"
              onClick={() => downloadImage(selected.id, selected.isOld)}
              className="flex items-center justify-center gap-2 min-h-11 px-6 bg-surface text-ink rounded-full font-medium hover:bg-brand-strong hover:text-surface transition-colors whitespace-nowrap"
            >
              <Download className="w-5 h-5" strokeWidth={1.5} />
              下载图片
            </button>
          }
        />
      )}
    </div>
  );
}

function sameImages(a: ResultImage[], b: ResultImage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.imageType !== y.imageType ||
      x.data !== y.data ||
      x.index !== y.index ||
      x.backup?.id !== y.backup?.id ||
      x.backup?.data !== y.backup?.data
    ) {
      return false;
    }
  }
  return true;
}

// 父组件每次渲染都会 map 出新的 images 数组：按字段比较，内容没变就不重渲整个图库
export const ResultGallery = memo(
  ResultGalleryImpl,
  (prev, next) =>
    prev.onRegenerate === next.onRegenerate &&
    prev.onAcceptNewVersion === next.onAcceptNewVersion &&
    prev.onRejectNewVersion === next.onRejectNewVersion &&
    sameImages(prev.images, next.images)
);
