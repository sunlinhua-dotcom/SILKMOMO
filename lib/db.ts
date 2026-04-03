import Dexie, { Table } from 'dexie';

// ===== 类型定义 =====

export type ProjectStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ModuleType = 'product' | 'scene';
export type SkuType = 'outfit' | 'top' | 'bottom';
export type SkinTone = 'light' | 'medium' | 'deep';
export type BodyType = 'slim' | 'standard' | 'curvy';
export type ShootingAngle = 'front' | 'side' | 'back';
export type FrameType = 'full_body' | 'upper_body' | 'lower_body' | 'close_up';
export type ImageType = 'product' | 'model_ref' | 'scene_ref' | 'bg_ref' | 'accessory' | 'result';

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

  // 产品图模块专属
  skuType?: SkuType;             // SKU 类型：套装 / 单件上装 / 单件下装
  selectedShots?: string;        // JSON 序列化的选中镜号数组 [1,2,3,4,9]
  outputSize?: string;           // 输出尺寸 "1200x1500" 或 "custom"
  customWidth?: number;          // 自定义宽度
  customHeight?: number;         // 自定义高度

  // 场景图模块专属
  sceneOutputSize?: string;      // 场景图输出尺寸

  // 兼容旧版
  styleId?: string;
}

export interface ImageItem {
  id?: number;
  projectId: number;
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

  // 兼容旧版
  imageType?: 'hero' | 'full_body' | 'half_body' | 'close_up';
  index?: number;
}

export interface StylePack {
  id?: number;
  name: string;
  createdAt: Date;
  description?: string;
  // 风格包实际图片存在 ImageItem 中，通过 projectId 关联
}

// ===== Dexie 数据库类 =====

export class SilkMomoDB extends Dexie {
  projects!: Table<Project>;
  images!: Table<ImageItem>;
  stylePacks!: Table<StylePack>;

  constructor() {
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
  }
}

export const db = new SilkMomoDB();
