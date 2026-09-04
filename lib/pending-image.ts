/**
 * 生成结果的「交接缓冲」。
 *
 * 为什么存在：原来服务端把整张 4~5MB 的图作为**一条** SSE `data:` 行推给客户端。
 * 0731 线上实测一张图传了 105 秒，期间客户端解析不出完整事件，判断「服务端是否还在
 * 推进」的时间戳冻住，看门狗误判卡死并掐断连接 —— 服务端记 "client disconnected
 * before delivery"，而图早就生成好了，是在下行路上丢的。
 *
 * 现在：服务端写这里 → SSE 只推 id（几十字节）→ 客户端用普通 HTTP GET 取图
 * （浏览器自管重试，不经过看门狗）→ 落 IndexedDB 后 DELETE 掉。
 *
 * 所以这不是图库：行的寿命只有「生成完 → 客户端取走」这一小段，峰值＝在途张数。
 * 客户端没来取的（断网/关页面）由 TTL 清理兜底，同时也正是断网重连后能补拉的来源。
 */
import prisma from '@/lib/prisma';
import { limitWithHasMore, pendingKindsForList } from '@/lib/pending-delivery-core';

/** 未被取走的图保留多久。够覆盖「断网 → 用户重开页面补拉」，又不会让库长期堆积。 */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingImageMeta {
  id: string;
  kind: string;
  shotIndex: number;
  width: number;
  height: number;
  mimeType: string;
  createdAt: Date;
}

export interface StalePendingImage extends PendingImageMeta {
  userId: string;
  taskId: number;
  idempotencyKey: string | null;
}

/**
 * 落库并返回 id。fail-open：写失败返回 null，调用方应回退成「直接把图推下去」，
 * 绝不能因为交接缓冲不可用就让用户丢掉一张已经扣过费的图。
 */
export async function storePendingImage(input: {
  userId: string;
  taskId: number;
  shotIndex: number;
  data: string;
  mimeType?: string;
  width?: number;
  height?: number;
  kind?: 'result' | 'anchor';
  idempotencyKey?: string;
}): Promise<string | null> {
  try {
    const row = await prisma.pendingImage.create({
      data: {
        userId: input.userId,
        taskId: input.taskId,
        shotIndex: input.shotIndex,
        kind: input.kind || 'result',
        idempotencyKey: input.idempotencyKey,
        data: input.data,
        mimeType: input.mimeType || 'image/png',
        width: input.width ?? 0,
        height: input.height ?? 0,
      },
      select: { id: true },
    });
    // 顺手清一次过期的：没有定时任务，挂在写入路径上最省事，失败也不影响主流程
    sweepExpiredPendingImages().catch(() => { /* 清理失败不影响出图 */ });
    return row.id;
  } catch (err) {
    console.log('[pending-image] 落库失败，回退直推:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** 按 id 取图，userId 必须匹配（防越权取别人的图）。不删除——删除由客户端确认落库后显式调用。 */
export async function readPendingImage(id: string, userId: string) {
  return prisma.pendingImage.findFirst({
    where: { id, userId },
    select: { id: true, kind: true, data: true, mimeType: true, width: true, height: true, shotIndex: true },
  });
}

/** 客户端确认已落 IndexedDB 后调用。删不掉也没关系，TTL 会兜底。 */
export async function deletePendingImage(id: string, userId: string): Promise<boolean> {
  const res = await prisma.pendingImage.deleteMany({ where: { id, userId } });
  return res.count > 0;
}

/**
 * 断网重连后的补拉入口：列出该任务下还没被取走的图（只给元信息，不带 base64，
 * 免得这个接口本身又变成一次大传输）。
 */
export async function listPendingImages(
  userId: string,
  taskId: number,
  includeAnchor = false,
): Promise<PendingImageMeta[]> {
  return prisma.pendingImage.findMany({
    where: { userId, taskId, kind: { in: pendingKindsForList(includeAnchor) } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, shotIndex: true, width: true, height: true, mimeType: true, createdAt: true },
    take: 50,
  });
}

/** 同一 run 的重复请求只允许复用它自己已经落好的结果。 */
export async function findPendingImageByIdempotencyKey(userId: string, idempotencyKey: string) {
  return prisma.pendingImage.findFirst({
    where: { userId, idempotencyKey, kind: 'result' },
    select: { id: true, shotIndex: true, width: true, height: true, mimeType: true },
  });
}

/** 管理员只读对账：结果已扣费落库，但超过 10 分钟仍未收到客户端 DELETE 回执。 */
export async function listStalePendingImages(ageMs = 10 * 60 * 1000, limit = 200): Promise<{
  records: StalePendingImage[];
  hasMore: boolean;
}> {
  const cutoff = new Date(Date.now() - ageMs);
  const rows = await prisma.pendingImage.findMany({
    where: { kind: 'result', createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' },
    take: limit + 1,
    select: {
      id: true,
      kind: true,
      userId: true,
      taskId: true,
      shotIndex: true,
      width: true,
      height: true,
      mimeType: true,
      idempotencyKey: true,
      createdAt: true,
    },
  });
  return limitWithHasMore(rows, limit);
}

export async function sweepExpiredPendingImages(): Promise<number> {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS);
  const res = await prisma.pendingImage.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (res.count > 0) console.log(`[pending-image] 清理过期交接图 ${res.count} 条`);
  return res.count;
}
