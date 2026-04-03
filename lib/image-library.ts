/**
 * 图库 + 时光机：本地存储管理
 * 
 * 1. ImageLibrary — 保存用户上传过的图片缩略图（base64），供下次复用
 * 2. TimeMachine — 保存完整的生成参数快照，支持一键回放
 */

import type { CompressedImage } from './image-compressor';

// ═══════════════════════════════════════
// 图库（Image Library）
// ═══════════════════════════════════════

const IMAGE_LIBRARY_KEY = 'silkmomo_image_library';
const MAX_LIBRARY_IMAGES = 20;

export interface LibraryImage {
  id: string;
  dataUrl: string;       // 缩略图 dataUrl
  base64: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  originalSize: number;
  addedAt: number;       // 时间戳
  label?: string;        // 可选标签（如"白色T恤"）
}

/** 获取图库所有图片 */
export function getLibraryImages(): LibraryImage[] {
  try {
    const raw = localStorage.getItem(IMAGE_LIBRARY_KEY);
    if (!raw) return [];
    const images = JSON.parse(raw) as LibraryImage[];
    // 按添加时间倒序
    return images.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

/** 将压缩后的图片添加到图库 */
export function addToLibrary(images: CompressedImage[]): LibraryImage[] {
  const existing = getLibraryImages();
  
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
  }));

  // 去重（按 base64 前 100 字符判断）
  const existingFingerprints = new Set(existing.map(e => e.base64.slice(0, 100)));
  const uniqueNew = newEntries.filter(n => !existingFingerprints.has(n.base64.slice(0, 100)));

  // 合并并截断
  const merged = [...uniqueNew, ...existing].slice(0, MAX_LIBRARY_IMAGES);

  try {
    localStorage.setItem(IMAGE_LIBRARY_KEY, JSON.stringify(merged));
  } catch (e) {
    // localStorage 满了，尝试缩减
    console.warn('图库存储空间不足，清理旧图片', e);
    const reduced = merged.slice(0, 10);
    try {
      localStorage.setItem(IMAGE_LIBRARY_KEY, JSON.stringify(reduced));
    } catch {
      // 仍然失败 — 彻底无法存储
    }
    // 返回带 warning 标记的结果
    (reduced as LibraryImage[] & { _storageWarning?: boolean })._storageWarning = true;
    return reduced;
  }

  return merged;
}

/** 从图库删除指定图片 */
export function removeFromLibrary(imageId: string): LibraryImage[] {
  const images = getLibraryImages().filter(img => img.id !== imageId);
  localStorage.setItem(IMAGE_LIBRARY_KEY, JSON.stringify(images));
  return images;
}

/** 清空图库 */
export function clearLibrary(): void {
  localStorage.removeItem(IMAGE_LIBRARY_KEY);
}

/** 检查 localStorage 剩余空间是否不足（粗略估算） */
export function isStorageNearFull(): boolean {
  try {
    const libSize = (localStorage.getItem(IMAGE_LIBRARY_KEY) || '').length;
    const snapSize = (localStorage.getItem(TIME_MACHINE_KEY) || '').length;
    // 超过 4MB 视为接近满载（localStorage 上限通常 5MB）
    return (libSize + snapSize) > 4 * 1024 * 1024;
  } catch {
    return true;
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
    localStorage.setItem(TIME_MACHINE_KEY, JSON.stringify(reduced));
  }

  return full;
}

/** 删除快照 */
export function removeSnapshot(snapshotId: string): FlowSnapshot[] {
  const snapshots = getSnapshots().filter(s => s.id !== snapshotId);
  localStorage.setItem(TIME_MACHINE_KEY, JSON.stringify(snapshots));
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
