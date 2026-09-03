import prisma from '@/lib/prisma';

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

export async function storeModelFace(input: StoreModelFaceInput) {
  return prisma.modelFace.create({
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
