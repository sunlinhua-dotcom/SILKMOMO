import prisma from '@/lib/prisma';
import type { PrismaClient } from '@prisma/client';

export const MODEL_FACE_PUBLIC_SELECT = {
  id: true,
  image: true,
  mimeType: true,
  specIndex: true,
  recipeLabel: true,
  favorite: true,
  name: true,
  createdAt: true,
} as const;

export interface StoreModelFaceInput {
  userId: string;
  image: string;
  mimeType: string;
  specIndex: number;
  recipeLabel: string;
}

type ModelFaceWriter = Pick<PrismaClient, 'modelFace'>;

export async function storeModelFace(input: StoreModelFaceInput, client: ModelFaceWriter = prisma) {
  return client.modelFace.create({
    data: {
      userId: input.userId,
      image: input.image,
      mimeType: input.mimeType,
      specIndex: input.specIndex,
      recipeLabel: input.recipeLabel,
    },
    select: MODEL_FACE_PUBLIC_SELECT,
  });
}

export async function listModelFaces(userId: string) {
  return prisma.modelFace.findMany({
    where: { userId },
    orderBy: [{ favorite: 'desc' }, { createdAt: 'desc' }],
    select: MODEL_FACE_PUBLIC_SELECT,
  });
}

/** fresh 未显式选脸时，从该账号的御用脸中等概率取一张；无御用脸返回 null。 */
export async function getRandomFavoriteModelFace(userId: string) {
  const where = { userId, favorite: true };
  const count = await prisma.modelFace.count({ where });
  if (count === 0) return null;
  return prisma.modelFace.findFirst({
    where: { userId, favorite: true },
    skip: Math.floor(Math.random() * count),
    orderBy: { id: 'asc' },
    select: { id: true, image: true, mimeType: true, specIndex: true },
  });
}
