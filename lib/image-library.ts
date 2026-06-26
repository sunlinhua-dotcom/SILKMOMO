/**
 * 图库 + 时光机：本地存储管理
 *
 * 1. ImageLibrary — 保存用户上传过的图片（IndexedDB），供下次复用。
 *    历史版本存 localStorage：单条 dataUrl+base64 双份全图 ≈ 2MB 字符，
 *    存 2-3 张即击穿 5MB 配额并静默丢图。现迁移至 Dexie，首次访问自动搬运旧数据。
 * 2. TimeMachine — 保存完整的生成参数快照（仍在 localStorage，只存 64px 缩略图，体积小）
 */

import type { CompressedImage } from './image-compressor';
import { db, type LibraryImageRow } from './db';

// ═══════════════════════════════════════
// 图库（Image Library）
// ═══════════════════════════════════════

const LEGACY_IMAGE_LIBRARY_KEY = 'silkmomo_image_library';
const MAX_LIBRARY_IMAGES = 20;

export type LibraryImage = LibraryImageRow;

// 一次性迁移 localStorage 旧图库 → IndexedDB（互斥，避免并发双跑）
let libraryMigrationPromise: Promise<void> | null = null;
let libraryMigrationDone = false;

function migrateLegacyLibrary(): Promise<void> {
  if (libraryMigrationDone || typeof window === 'undefined') return Promise.resolve();
  if (!libraryMigrationPromise) {
    libraryMigrationPromise = (async () => {
      try {
        const raw = window.localStorage.getItem(LEGACY_IMAGE_LIBRARY_KEY);
        if (raw) {
          let rows: LibraryImage[] | null = null;
          let corrupt = false;
          try {
            const legacy = JSON.parse(raw);
            rows = Array.isArray(legacy) ? legacy.filter(i => i && i.id && i.base64) : [];
          } catch {
            corrupt = true; // JSON 解析失败 = 数据已损坏，保留也无意义
          }

          if (corrupt) {
            window.localStorage.removeItem(LEGACY_IMAGE_LIBRARY_KEY);
          } else if (rows) {
            // 关键顺序：必须先写成功 IndexedDB，再删 localStorage 源。
            // 否则写失败时源被删 → 图库永久丢失。
            try {
              if (rows.length > 0) await db.libraryImages.bulkPut(rows);
              window.localStorage.removeItem(LEGACY_IMAGE_LIBRARY_KEY);
            } catch (e) {
              // 写入失败：保留 localStorage 源，不置 done，下次调用重试（bulkPut 幂等）
              console.warn('图库迁移写入失败，保留本地数据下次重试:', e);
              return;
            }
          }
        }
        libraryMigrationDone = true;
      } finally {
        libraryMigrationPromise = null;
      }
    })();
  }
  return libraryMigrationPromise;
}

/** 获取图库所有图片（按添加时间倒序） */
export async function getLibraryImages(): Promise<LibraryImage[]> {
  try {
    await migrateLegacyLibrary();
    return await db.libraryImages.orderBy('addedAt').reverse().toArray();
  } catch {
    return [];
  }
}

/** 将压缩后的图片添加到图库 */
export async function addToLibrary(
  images: CompressedImage[],
  category?: 'product' | 'model_ref' | 'bg_ref' | 'scene_ref' | 'accessory'
): Promise<LibraryImage[]> {
  try {
    await migrateLegacyLibrary();
    const existing = await db.libraryImages.toArray();

    const newEntries: LibraryImage[] = images.map(img => ({
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dataUrl: img.dataUrl,
      base64: img.base64,
      mimeType: img.mimeType,
      size: img.size,
      width: img.width,
      height: img.height,
      originalSize: img.originalSize ?? img.size,
      addedAt: Date.now(),
      category,
    }));

    // 去重指纹：只取 base64 前 100 字符会把同源/同模板图片(头部相同)误判为重复而静默丢弃。
    // 改用 体积 + 像素尺寸 + 长度 + 尾部 64 字符 组合，区分度足够且无需哈希全量。
    const fp = (e: { size: number; width: number; height: number; base64: string }) =>
      `${e.size}_${e.width}x${e.height}_${e.base64.length}_${e.base64.slice(-64)}`;
    const existingFingerprints = new Set(existing.map(fp));
    const uniqueNew = newEntries.filter(n => !existingFingerprints.has(fp(n)));

    if (uniqueNew.length > 0) {
      await db.libraryImages.bulkAdd(uniqueNew);
    }

    // 超出上限时删除最旧的
    const total = await db.libraryImages.count();
    if (total > MAX_LIBRARY_IMAGES) {
      const overflow = await db.libraryImages
        .orderBy('addedAt')
        .limit(total - MAX_LIBRARY_IMAGES)
        .toArray();
      await db.libraryImages.bulkDelete(overflow.map(o => o.id));
    }

    return await db.libraryImages.orderBy('addedAt').reverse().toArray();
  } catch (e) {
    console.warn('图库写入失败:', e);
    return [];
  }
}

/** 从图库删除指定图片 */
export async function removeFromLibrary(imageId: string): Promise<LibraryImage[]> {
  try {
    await db.libraryImages.delete(imageId);
    return await db.libraryImages.orderBy('addedAt').reverse().toArray();
  } catch {
    return [];
  }
}

/** 清空图库 */
export async function clearLibrary(): Promise<void> {
  try {
    await db.libraryImages.clear();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LEGACY_IMAGE_LIBRARY_KEY);
    }
  } catch {
    // ignore
  }
}

/** 将 LibraryImage 转为 CompressedImage（选中后传给上传组件） */
export function libraryToCompressed(lib: LibraryImage): CompressedImage {
  return {
    dataUrl: lib.dataUrl,
    base64: lib.base64,
    mimeType: lib.mimeType,
    size: lib.size,
    width: lib.width,
    height: lib.height,
    originalSize: lib.originalSize,
  };
}


// ═══════════════════════════════════════
// 时光机（Time Machine）
// ═══════════════════════════════════════

const TIME_MACHINE_KEY = 'silkmomo_time_machine';
const MAX_SNAPSHOTS = 10;

export interface FlowSnapshot {
  id: string;
  createdAt: number;
  label: string;               // 自动生成的描述（如 "产品图 · 纤细 · 3张"）

  // 核心参数
  module: 'product' | 'scene';
  bodyType: string;
  skinTone: string;
  modelId?: string;

  // 引擎 / SKU / 尺寸 / 场景模式 —— 不存这些字段的话
  // "用相同参数重新生成"会沿用页面当前残留值，与快照承诺不符
  engine?: 'gemini' | 'openai';
  skuType?: 'outfit' | 'top' | 'bottom';
  sceneHasModel?: boolean;
  outputSize?: string;          // product/scene 模块各自的尺寸 id

  // 产品图相关
  selectedShots?: number[];     // 镜次索引
  customPrompt?: string;

  // 图片引用（存缩略图而非完整图）
  productImageThumbs: string[]; // 小尺寸缩略图 dataUrl
  sceneRefThumbs?: string[];

  // 结果
  taskId?: string;              // 关联的任务 ID
}

/** 获取所有快照 */
export function getSnapshots(): FlowSnapshot[] {
  try {
    const raw = localStorage.getItem(TIME_MACHINE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as FlowSnapshot[]).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** 保存一个快照 */
export function saveSnapshot(snapshot: Omit<FlowSnapshot, 'id' | 'createdAt'>): FlowSnapshot {
  const existing = getSnapshots();

  const full: FlowSnapshot = {
    ...snapshot,
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };

  const merged = [full, ...existing].slice(0, MAX_SNAPSHOTS);

  try {
    localStorage.setItem(TIME_MACHINE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('时光机存储空间不足', e);
    const reduced = merged.slice(0, 5);
    try {
      localStorage.setItem(TIME_MACHINE_KEY, JSON.stringify(reduced));
    } catch {
      // 仍然失败 — 放弃本次快照
    }
  }

  return full;
}

/** 删除快照 */
export function removeSnapshot(snapshotId: string): FlowSnapshot[] {
  const snapshots = getSnapshots().filter(s => s.id !== snapshotId);
  try {
    localStorage.setItem(TIME_MACHINE_KEY, JSON.stringify(snapshots));
  } catch {
    // ignore
  }
  return snapshots;
}

/**
 * 为缩略图生成极小预览（64x64）用于快照存储
 * 避免快照数据过大
 */
export function generateThumb(dataUrl: string, size = 64): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // 居中裁切
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;

      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
      resolve(canvas.toDataURL('image/webp', 0.5));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}
