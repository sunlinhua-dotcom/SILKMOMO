import Dexie, { Table } from 'dexie';

export interface Project {
  id?: number;
  createdAt: Date;
  updatedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  name: string;
}

export interface ImageItem {
  id?: number;
  projectId: number;
  type: 'product' | 'style' | 'accessory' | 'result';
  data: string; // Base64
  mimeType: string;
  prompt?: string;
  imageType?: 'hero' | 'full_body' | 'half_body' | 'close_up';
  index?: number;
}

export class SilkMomoDB extends Dexie {
  projects!: Table<Project>;
  images!: Table<ImageItem>;

  constructor() {
    super('SilkMomoDB');
    this.version(1).stores({
      projects: '++id, createdAt, status',
      images: '++id, projectId, type, imageType, index'
    });
  }
}

export const db = new SilkMomoDB();
