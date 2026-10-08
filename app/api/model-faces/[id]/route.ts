import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import {
  MODEL_FACE_PUBLIC_SELECT,
  ModelFaceStorageUnavailableError,
  deleteModelFace,
  getModelFaceImage,
  getModelFaceThumbnail,
} from '@/lib/model-face-library';

type RouteContext = { params: Promise<{ id: string }> };

/** 图片在对象存储里但取不到（未配置 / 对象缺失 / 存储故障）：503 + 明确文案，不让路由崩成 500。 */
function storageUnavailable(error: ModelFaceStorageUnavailableError) {
  console.warn('[model-faces] 图片存储不可用:', error.reason, error.message);
  return NextResponse.json({ error: '模特脸图片暂时读取不到，请稍后重试', reason: error.reason }, { status: 503 });
}

export async function GET(req: Request, { params }: RouteContext) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const thumbnail = new URL(req.url).searchParams.get('variant') === 'thumbnail';
  try {
    if (thumbnail) {
      const result = await getModelFaceThumbnail(auth.userId, id);
      if (!result) return NextResponse.json({ error: '模特脸不存在' }, { status: 404 });
      return new NextResponse(new Uint8Array(result.data), {
        headers: {
          'Content-Type': result.mimeType,
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }

    const face = await getModelFaceImage(auth.userId, id);
    if (!face) return NextResponse.json({ error: '模特脸不存在' }, { status: 404 });
    return NextResponse.json({ image: face.image, mimeType: face.mimeType });
  } catch (error) {
    if (error instanceof ModelFaceStorageUnavailableError) return storageUnavailable(error);
    throw error;
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: { favorite?: boolean; name?: string } = {};

  if (typeof body.favorite === 'boolean') data.favorite = body.favorite;
  if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 40);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const result = await prisma.modelFace.updateMany({
    where: { id, userId: auth.userId },
    data,
  });
  if (result.count === 0) return NextResponse.json({ error: '模特脸不存在' }, { status: 404 });

  const face = await prisma.modelFace.findFirstOrThrow({
    where: { id, userId: auth.userId },
    select: MODEL_FACE_PUBLIC_SELECT,
  });
  return NextResponse.json({ face });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const auth = await getCurrentUser();
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { id } = await params;

  // 删库行后尽力删对象存储里的图，失败只记日志（见 deleteModelFace）
  const deleted = await deleteModelFace(auth.userId, id);
  if (!deleted) return NextResponse.json({ error: '模特脸不存在' }, { status: 404 });
  return NextResponse.json({ success: true });
}
