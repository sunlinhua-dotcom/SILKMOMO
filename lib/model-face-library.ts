import prisma from '@/lib/prisma';
import {
  MODEL_FACE_JPEG_QUALITY,
  MODEL_FACE_THUMBNAIL_WIDTH,
  prepareModelFaceImage,
} from '@/lib/model-face-image';
import type { Prisma } from '@prisma/client';

export const MODEL_FACE_PAGE_SIZE = 60;
export { MODEL_FACE_JPEG_QUALITY, MODEL_FACE_THUMBNAIL_WIDTH, prepareModelFaceImage };

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

type ModelFaceWriter = Pick<Prisma.TransactionClient, 'modelFace'>;

export async function storeModelFace(input: StoreModelFaceInput, client: ModelFaceWriter = prisma) {
  const normalized = await prepareModelFaceImage(input.image);
  return storePreparedModelFace(input, normalized, client);
}

export function storePreparedModelFace(
  input: StoreModelFaceInput,
  normalized: PreparedModelFaceImage,
  client: ModelFaceWriter = prisma,
) {
  return client.modelFace.create({
    data: {
      userId: input.userId,
      image: normalized.image,
      thumbnail: normalized.thumbnail,
      mimeType: normalized.mimeType,
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

export async function getModelFaceImage(userId: string, id: string) {
  return prisma.modelFace.findFirst({
    where: { id, userId },
    select: { id: true, image: true, mimeType: true },
  });
}

/** Legacy PNG rows get compacted lazily when their thumbnail is first displayed. */
export async function getModelFaceThumbnail(userId: string, id: string) {
  const face = await prisma.modelFace.findFirst({
    where: { id, userId },
    select: { id: true, thumbnail: true, image: true, mimeType: true },
  });
  if (!face) return null;
  if (face.thumbnail) return { data: face.thumbnail, mimeType: 'image/jpeg' };

  const normalized = await prepareModelFaceImage(face.image);
  await prisma.modelFace.updateMany({
    where: { id, userId, thumbnail: null },
    data: normalized,
  });
  return { data: normalized.thumbnail, mimeType: normalized.mimeType };
}

/** fresh 未显式选脸时，从该账号的御用脸中等概率取一张；无御用脸返回 null。 */
export async function getRandomFavoriteModelFace(userId: string) {
  const where = { userId, favorite: true };
  const count = await prisma.modelFace.count({ where });
  if (count === 0) return null;
  return prisma.modelFace.findFirst({
    where,
    skip: Math.floor(Math.random() * count),
    orderBy: { id: 'asc' },
    select: { id: true, image: true, mimeType: true, specIndex: true },
  });
}
