import prisma from '@/lib/prisma';
import {
  MODEL_FACE_JPEG_QUALITY,
  MODEL_FACE_THUMBNAIL_WIDTH,
  prepareModelFaceImage,
} from '@/lib/model-face-image';
import { getObjectStorage } from '@/lib/object-storage';
import {
  ModelFaceStorageUnavailableError,
  deleteModelFaceObjects,
  newModelFaceId,
  readModelFaceBytes,
  uploadModelFaceImages,
} from '@/lib/model-face-storage';
import type { Prisma } from '@prisma/client';

export const MODEL_FACE_PAGE_SIZE = 60;
export { MODEL_FACE_JPEG_QUALITY, MODEL_FACE_THUMBNAIL_WIDTH, prepareModelFaceImage, ModelFaceStorageUnavailableError };

export const MODEL_FACE_LIST_SELECT = {
  id: true,
  thumbnail: true,
  recipeLabel: true,
  favorite: true,
  name: true,
  createdAt: true,
} as const;

// Mutations return the same bounded representation as the paginated list.
export const MODEL_FACE_PUBLIC_SELECT = MODEL_FACE_LIST_SELECT;

export interface StoreModelFaceInput {
  userId: string;
  image: string;
  mimeType: string;
  specIndex: number;
  recipeLabel: string;
}

interface PreparedModelFaceImage {
  image: string;
  thumbnail: string;
  mimeType: 'image/jpeg';
}

/**
 * 已决定好存放位置的脸图：要么 imageKey/thumbnailKey 有值（图在对象存储，image/thumbnail 为 null），
 * 要么 image/thumbnail 有值（存库，对象存储未启用或上传失败回退）。id 提前生成，因为 key 里要带 faceId。
 */
export interface PersistedModelFaceImages {
  id: string;
  userId: string;
  mimeType: 'image/jpeg';
  image: string | null;
  thumbnail: string | null;
  imageKey: string | null;
  thumbnailKey: string | null;
}

type ModelFaceWriter = Pick<Prisma.TransactionClient, 'modelFace'>;

/**
 * 把规范化后的脸图放到该去的地方。必须在数据库事务**之外**调用（要走网络，不能占着事务）。
 * 对象存储未启用 → 原样存库；启用但上传失败 → 日志告警后回退存库，永远不抛。
 */
export async function persistPreparedModelFaceImages(
  userId: string,
  normalized: PreparedModelFaceImage,
): Promise<PersistedModelFaceImages> {
  const id = newModelFaceId();
  const keys = await uploadModelFaceImages(
    { userId, faceId: id, image: normalized.image, thumbnail: normalized.thumbnail },
    getObjectStorage(),
  );
  if (keys) {
    return {
      id, userId, mimeType: normalized.mimeType,
      image: null, thumbnail: null, imageKey: keys.imageKey, thumbnailKey: keys.thumbnailKey,
    };
  }
  return {
    id, userId, mimeType: normalized.mimeType,
    image: normalized.image, thumbnail: normalized.thumbnail, imageKey: null, thumbnailKey: null,
  };
}

/**
 * 入库事务失败后调用：若行确实没写进去，就清掉刚上传的对象，避免孤儿。
 * 先查一次行是否存在——提交结果不明确（比如提交时断连）时宁可留孤儿也不删有主对象。
 */
export async function discardUnstoredModelFaceImages(persisted: PersistedModelFaceImages): Promise<void> {
  if (!persisted.imageKey && !persisted.thumbnailKey) return;
  try {
    const exists = await prisma.modelFace.findUnique({ where: { id: persisted.id }, select: { id: true } });
    if (exists) return;
  } catch (error) {
    console.warn('[model-face-library] 无法确认脸是否已入库，保留对象存储里的图片:', error instanceof Error ? error.message : error);
    return;
  }
  await deleteModelFaceObjects(persisted, getObjectStorage());
}

export async function storeModelFace(input: StoreModelFaceInput, client: ModelFaceWriter = prisma) {
  const normalized = await prepareModelFaceImage(input.image);
  const persisted = await persistPreparedModelFaceImages(input.userId, normalized);
  try {
    return await storePreparedModelFace(input, persisted, client);
  } catch (error) {
    await discardUnstoredModelFaceImages(persisted);
    throw error;
  }
}

export function storePreparedModelFace(
  input: StoreModelFaceInput,
  persisted: PersistedModelFaceImages,
  client: ModelFaceWriter = prisma,
) {
  return client.modelFace.create({
    data: {
      id: persisted.id,
      userId: input.userId,
      image: persisted.image,
      thumbnail: persisted.thumbnail,
      imageKey: persisted.imageKey,
      thumbnailKey: persisted.thumbnailKey,
      mimeType: persisted.mimeType,
      specIndex: input.specIndex,
      recipeLabel: input.recipeLabel,
    },
    select: MODEL_FACE_LIST_SELECT,
  });
}

export async function listModelFaces(userId: string, page = 1, pageSize = MODEL_FACE_PAGE_SIZE) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0
    ? Math.min(pageSize, MODEL_FACE_PAGE_SIZE)
    : MODEL_FACE_PAGE_SIZE;
  const where = { userId };
  const [faces, total] = await Promise.all([
    prisma.modelFace.findMany({
      where,
      orderBy: [{ favorite: 'desc' }, { createdAt: 'desc' }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
      select: MODEL_FACE_LIST_SELECT,
    }),
    prisma.modelFace.count({ where }),
  ]);
  return {
    faces,
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    },
  };
}

/** 原图 base64（统一读取入口：优先对象存储 key，没有 key 读库）。存储不可用时抛 ModelFaceStorageUnavailableError。 */
export async function getModelFaceImage(userId: string, id: string) {
  const face = await prisma.modelFace.findFirst({
    where: { id, userId },
    select: { id: true, image: true, imageKey: true, mimeType: true },
  });
  if (!face) return null;
  const bytes = await readModelFaceBytes({ key: face.imageKey, inline: face.image }, getObjectStorage());
  return { id: face.id, image: bytes.toString('base64'), mimeType: face.mimeType };
}

/** Legacy PNG rows get compacted lazily when their thumbnail is first displayed. */
export async function getModelFaceThumbnail(userId: string, id: string) {
  const face = await prisma.modelFace.findFirst({
    where: { id, userId },
    select: { id: true, thumbnail: true, thumbnailKey: true, image: true, imageKey: true, mimeType: true },
  });
  if (!face) return null;
  const storage = getObjectStorage();
  if (face.thumbnail || face.thumbnailKey) {
    const bytes = await readModelFaceBytes({ key: face.thumbnailKey, inline: face.thumbnail }, storage);
    return { data: bytes, mimeType: 'image/jpeg' };
  }

  // 没有缩略图的老行：从原图（库里或对象存储里）现算一张
  const original = await readModelFaceBytes({ key: face.imageKey, inline: face.image }, storage);
  const normalized = await prepareModelFaceImage(original.toString('base64'));
  await prisma.modelFace.updateMany({
    where: { id, userId, thumbnail: null, thumbnailKey: null },
    // 对象存储里的行只补缩略图（几十 KB 以内），不回写原图；库内行保持原来的「压实原图」行为
    data: face.imageKey ? { thumbnail: normalized.thumbnail } : normalized,
  });
  return { data: Buffer.from(normalized.thumbnail, 'base64'), mimeType: normalized.mimeType };
}

/**
 * 删除一张脸（属主校验在 where 里）。库行删掉后尽力清对象存储：失败只记日志、不阻断。
 * 返回是否删到了行。
 */
export async function deleteModelFace(userId: string, id: string): Promise<boolean> {
  const face = await prisma.modelFace.findFirst({
    where: { id, userId },
    select: { imageKey: true, thumbnailKey: true },
  });
  const result = await prisma.modelFace.deleteMany({ where: { id, userId } });
  if (result.count === 0) return false;
  if (face?.imageKey || face?.thumbnailKey) {
    await deleteModelFaceObjects(face, getObjectStorage());
  }
  return true;
}

/**
 * fresh 未显式选脸时，从该账号的御用脸中等概率取一张；无御用脸返回 null。
 * 返回的 image 是 base64（统一读取入口）。对象存储读不到时记日志并返回 null——
 * 与「没有御用脸」同路径继续出图，不让付费生成因为存储故障整条失败。
 */
export async function getRandomFavoriteModelFace(userId: string) {
  const where = { userId, favorite: true };
  const count = await prisma.modelFace.count({ where });
  if (count === 0) return null;
  const face = await prisma.modelFace.findFirst({
    where,
    skip: Math.floor(Math.random() * count),
    orderBy: { id: 'asc' },
    select: { id: true, image: true, imageKey: true, mimeType: true, specIndex: true },
  });
  if (!face) return null;
  try {
    const bytes = await readModelFaceBytes({ key: face.imageKey, inline: face.image }, getObjectStorage());
    return { id: face.id, image: bytes.toString('base64'), mimeType: face.mimeType, specIndex: face.specIndex };
  } catch (error) {
    if (error instanceof ModelFaceStorageUnavailableError) {
      console.warn('[model-face-library] 御用脸图片读取失败，本次按无御用脸继续:', face.id, error.message);
      return null;
    }
    throw error;
  }
}
