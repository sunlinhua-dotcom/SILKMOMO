import Dexie, { Table } from 'dexie';

// ===== 类型定义 =====

export type ProjectStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ModuleType = 'product' | 'scene';
export type SkuType = 'outfit' | 'top' | 'bottom';
export type SkinTone = 'light' | 'medium' | 'deep';
export type BodyType = 'slim' | 'standard' | 'curvy';
export type ShootingAngle = 'front' | 'side' | 'back';
export type FrameType = 'full_body' | 'upper_body' | 'lower_body' | 'close_up';
export type ImageType = 'product' | 'model_ref' | 'scene_ref' | 'bg_ref' | 'accessory' | 'anchor' | 'result' | 'result_backup';

export interface Project {
  id?: number;
  createdAt: Date;
  updatedAt: Date;
  status: ProjectStatus;
  name: string;

  // 模块类型
  moduleType?: ModuleType;

  // 共用输入层
  modelId?: string;              // 预设模特 ID（如果是预设模特）
  bodyType?: BodyType;           // 体型：slim / standard / curvy
  skinTone?: SkinTone;           // 肤色：light / medium / deep
  engine?: 'gemini' | 'openai';  // 生图引擎：gemini / openai (gpt-image-2-all)

  // 产品图模块专属
  skuType?: SkuType;             // SKU 类型：套装 / 单件上装 / 单件下装
  selectedShots?: string;        // JSON 序列化的选中镜号数组 [1,2,3,4,9]
  outputSize?: string;           // 输出尺寸 "1200x1500" 或 "custom"
  customWidth?: number;          // 自定义宽度
  customHeight?: number;         // 自定义高度

  // 场景图模块专属
  sceneOutputSize?: string;      // 场景图输出尺寸
  sceneHasModel?: boolean;       // 场景图：true=有模特，false=氛围静物

  // 场景图·组图（换装）模式专属
  sceneGroup?: boolean;              // true=组图（N 张 lookbook → N 张换装图）
  sceneGroupMode?: string;           // swap=N景1品；products=1景N品（非索引字段，不 bump Dexie version）
  sceneGroupCategories?: string;     // JSON: 分析出的主品品类（用于展示/回显）

  // 失败原因（status='failed' 时记录最后一次失败的具体错误，刷新页面也能看到）
  lastError?: string;

  // 兼容旧版
  styleId?: string;
  customPrompt?: string;
}

export interface ImageItem {
  id?: number;
  projectId: number;
  stylePackId?: number;          // 风格包图片使用独立归属，避免和 Project 自增 ID 冲突
  type: ImageType;
  data: string;                  // Base64
  mimeType: string;
  prompt?: string;

  // 结果图专属
  shotIndex?: number;            // 候选池中的序号 1-9
  shootingAngle?: ShootingAngle; // 拍摄角度
  frameType?: FrameType;         // 取景框架
  hasModel?: boolean;            // 是否含模特
  outputSize?: string;           // 该图的输出尺寸
  groupIndex?: number;           // 同景换品模式：产品组序号（非索引字段，不 bump Dexie version）

  // 兼容旧版
  imageType?: 'hero' | 'full_body' | 'half_body' | 'close_up';
  index?: number;
  backup?: {
    id: number;
    data: string;
  };
}

export interface StylePack {
  id?: number;
  name: string;
  createdAt: Date;
  description?: string;
  // 风格包实际图片存在 ImageItem 中，通过 projectId 关联
}

// 图库条目（lib/image-library.ts 使用；放这里避免循环依赖）
// 之前存 localStorage：单条 dataUrl+base64 双份全图 ≈ 2MB 字符，
// 存 2-3 张就击穿 5MB 配额并静默丢图，因此迁移到 IndexedDB
export interface LibraryImageRow {
  id: string;
  dataUrl: string;
  base64: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  originalSize: number;
  addedAt: number;
  label?: string;
  category?: 'product' | 'model_ref' | 'bg_ref' | 'scene_ref' | 'accessory';
}

// ===== Dexie 数据库类 =====

export class SilkMomoDB extends Dexie {
  projects!: Table<Project>;
  images!: Table<ImageItem>;
  stylePacks!: Table<StylePack>;
  libraryImages!: Table<LibraryImageRow>;

  constructor() {
    // 注意:品牌已更名 SILXINE,但 IndexedDB 库名保持 'SilkMomoDB' 不变——
    // 改名等于换库,所有用户的本地任务/图片会全部"丢失"。切勿重命名。
    super('SilkMomoDB');

    // version 1: 原始版本（保留，向后兼容）
    this.version(1).stores({
      projects: '++id, createdAt, status',
      images: '++id, projectId, type, imageType, index'
    });

    // version 2: Phase 2 升级（新增字段，新增 stylePacks 表）
    this.version(2).stores({
      projects: '++id, createdAt, status, moduleType, skuType',
      images: '++id, projectId, type, imageType, index, shotIndex',
      stylePacks: '++id, createdAt'
    });

    // version 3: 风格包图片从 projectId 关联迁移到 stylePackId，避免风格包 ID 与任务 ID 碰撞
    this.version(3).stores({
      projects: '++id, createdAt, status, moduleType, skuType',
      images: '++id, projectId, stylePackId, type, imageType, index, shotIndex',
      stylePacks: '++id, createdAt'
    });

    // version 4: 图库从 localStorage 迁入 IndexedDB（配额问题）
    this.version(4).stores({
      projects: '++id, createdAt, status, moduleType, skuType',
      images: '++id, projectId, stylePackId, type, imageType, index, shotIndex',
      stylePacks: '++id, createdAt',
      libraryImages: 'id, addedAt'
    });
  }
}

export const db = new SilkMomoDB();

export const STYLE_PACK_IMAGE_PROJECT_ID = 0;

// 迁移互斥：getStylePackImages 会被多个组件 / 生成入口并发调用，
// 双跑 "modernCount===0 → bulkAdd" 会把风格包图片复制成双份。
// 成功跑完一次后置 done 标记，同时避免每次全量重扫（O(N²) IndexedDB 查询）。
let stylePackMigrationPromise: Promise<void> | null = null;
let stylePackMigrationDone = false;

export function migrateLegacyStylePackImages(): Promise<void> {
  if (stylePackMigrationDone) return Promise.resolve();
  if (!stylePackMigrationPromise) {
    stylePackMigrationPromise = doMigrateLegacyStylePackImages()
      .then(() => { stylePackMigrationDone = true; })
      .finally(() => { stylePackMigrationPromise = null; });
  }
  return stylePackMigrationPromise;
}

async function doMigrateLegacyStylePackImages() {
  // 整个迁移放进一个事务：add 与 delete 要么都生效要么都回滚，
  // 中途断电/关页不会留下"已复制未删除"的双份状态
  await db.transaction('rw', db.stylePacks, db.images, db.projects, async () => {
    const packs = await db.stylePacks.toArray();

    for (const pack of packs) {
      if (!pack.id) continue;

      const legacyImages = await db.images
        .where('projectId')
        .equals(pack.id)
        .filter(img => img.type === 'scene_ref' && !img.stylePackId)
        .toArray();

      if (legacyImages.length === 0) continue;

      // 如果同 ID 的任务已经存在，legacy 图片归属无法可靠判断，避免迁移误伤任务数据。
      const collidingProject = await db.projects.get(pack.id);
      if (collidingProject) continue;

      const modernCount = await db.images.where('stylePackId').equals(pack.id).count();
      if (modernCount === 0) {
        await db.images.bulkAdd(
          legacyImages.map(img => ({
            projectId: STYLE_PACK_IMAGE_PROJECT_ID,
            stylePackId: pack.id,
            type: img.type,
            data: img.data,
            mimeType: img.mimeType,
          }))
        );
      }

      const legacyIds = legacyImages.map(img => img.id!).filter(Boolean);
      if (legacyIds.length > 0) {
        await db.images.bulkDelete(legacyIds);
      }
    }
  });
}

export async function getStylePackImages(packId: number): Promise<ImageItem[]> {
  await migrateLegacyStylePackImages();
  const modernImages = await db.images.where('stylePackId').equals(packId).toArray();
  if (modernImages.length > 0) return modernImages;

  const collidingProject = await db.projects.get(packId);
  if (collidingProject) return [];

  return db.images
    .where('projectId')
    .equals(packId)
    .filter(img => img.type === 'scene_ref' && !img.stylePackId)
    .toArray();
}

export async function deleteStylePackImages(packId: number) {
  await db.images.where('stylePackId').equals(packId).delete();

  const collidingProject = await db.projects.get(packId);
  if (!collidingProject) {
    await db.images
      .where('projectId')
      .equals(packId)
      .filter(img => img.type === 'scene_ref' && !img.stylePackId)
      .delete();
  }
}

export async function prepareProjectImageSlot(projectId: number) {
  const staleImages = await db.images
    .where('projectId')
    .equals(projectId)
    .filter(img => !img.stylePackId)
    .toArray();

  const staleIds = staleImages.map(img => img.id!).filter(Boolean);
  if (staleIds.length > 0) {
    await db.images.bulkDelete(staleIds);
  }
}
