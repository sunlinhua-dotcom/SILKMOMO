import { db, type ImageItem } from '@/lib/db';
import { compressImage } from '@/lib/image-compressor';
import { fetchPendingImageOutcome, fetchPendingImageWithRetry, type PendingFetchOutcome } from '@/lib/pending-fetch';
import { recoverPending, resolveSseGone, type PendingMeta, type PendingRecoveryResult } from '@/lib/pending-recovery-core';

// ===== [E] 看门狗与补拉 · 开始 =====
// ═══ SSE 停滞看门狗 ═══
// 服务端不可能让页面无限等待：单张最长 280s（lib/image-backends OPENAI_TIMEOUT_MS）后必报错退款，
// 且每 25s 发一次 keep-alive。但客户端读流时只是 await reader.read()——连接若在中途静默失效
// （服务端照常报错关流，字节却送不到浏览器），read() 永不返回，进度条就一直转。
// 线上实测出现过「已耗时 1301s 仍在生成镜次 #1」，即此。两道看门狗把无限等待收敛成可重试的错误：
//   ① 静默检测：keep-alive 每 25s 一次，超过 STALL_BYTES_MS 一个字节都没有 → 连接已断。
//   ② 兜底检测：字节还在来（服务端活着）但迟迟没有实质事件 → 服务端卡死在某个无超时的调用上。
//      阈值必须大于服务端单张最坏耗时（GPT：280s 超时 + 3s + 280s 重试；Gemini：120s×2 + 3s），
//      否则会误伤正常的慢请求。
// 0731：openai 档原为 150_000，比服务端单张上限（OPENAI_TIMEOUT_MS 280s，现 360s）还小，
// 与上面这条注释自相矛盾。只要服务端有任何一段长等待没被 withPhaseBeat 覆盖（`data:` 事件
// 才喂得到这道看门狗，25s 的 `: keep-alive` 注释行只喂上面的字节看门狗），慢的那一张就会
// 在 150s 被客户端主动 abort，服务端随后记成 "client disconnected before delivery"——
// 客户 0731 反馈的那张 166.7s 正是这个形状（同批 64~83s 的都成功）。
// 现在服务端所有长阶段都补齐了心跳，同时把这里抬到高于服务端上限，双保险。
// 真死连接由字节看门狗（120s，keep-alive 每 25s）兜住，检测速度不受影响。
export const STALL_BYTES_MS = 120_000;
export const STALL_EVENT_MS: Record<'openai' | 'gemini', number> = {
  openai: 400_000,
  gemini: 320_000,
};

async function compressAnchorBase64(
  imageData: string,
  mimeType = 'image/png',
): Promise<{ data: string; mimeType: string }> {
  const binary = atob(imageData);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const compressed = await compressImage(new File([bytes], 'scene-group-anchor', { type: mimeType }));
  return { data: compressed.base64, mimeType: compressed.mimeType };
}

/**
 * 锚图在「每一张」请求里都要重传，所以任何来源的锚都必须先压。
 * 0731 线上实测：补齐路径（「生成剩余 N 张」）直接拿一张全尺寸结果图当锚，
 * 服务端收到的是 2926199B image/png 1792x2400，压完只有 241KB —— 也就是每张
 * 请求白背约 3.9MB base64 上行。国内上行慢时，光上传就吃掉几十秒，请求被拖长、
 * 更容易撞上停滞看门狗；用户按提示再点「生成剩余」，又走同一条不压缩的路径，
 * 于是越点越糟。这里统一兜底：拿不准的来源一律过一次压缩，失败才沿用原图。
 */
// 已经压过的锚约 240KB（base64 ≈32 万字符）；没压过的全尺寸结果图约 2.9MB（≈390 万字符）。
// 用这个阈值把两者分开，让本函数幂等——老任务里存着的锚可以放心地反复过一遍，
// 不会每跑一次就被重新编码一次。
const ANCHOR_COMPRESS_THRESHOLD_CHARS = 700_000;
const PENDING_FETCH_TIMEOUT_MS = 10_000;
const PENDING_RECOVERY_ATTEMPTS = 3;

export async function toCompressedAnchor(
  source: { data: string; mimeType: string },
): Promise<{ data: string; mimeType: string }> {
  if (source.data.length < ANCHOR_COMPRESS_THRESHOLD_CHARS) return source;
  try {
    return await compressAnchorBase64(source.data, source.mimeType || 'image/png');
  } catch (error) {
    console.error('[anchor 压缩] 失败，沿用原图:', error);
    return source;
  }
}

/**
 * 从「交接缓冲」取一张图。
 *
 * 服务端不再把 4~5MB 的图塞进 SSE 的一条 data: 行（那正是 0731 客户「生成失败」的根因：
 * 下载期间解析不出完整事件，看门狗误判服务端卡死并掐断），改为只推一个 id，这里用普通
 * HTTP GET 取。普通请求由浏览器自己管重试和超时，不受 SSE 看门狗影响。
 *
 * 取不到不代表图没了 —— 它还在服务端等着，任务页重进时的补拉会捡回来。
 */
export async function fetchPendingImage(
  pendingId: string,
  attempts = 3,
): Promise<{ data: string; mimeType: string; width: number; height: number } | null> {
  return fetchPendingImageWithRetry(pendingId, {
    attempts,
    handshakeTimeoutMs: PENDING_FETCH_TIMEOUT_MS,
    onAttemptError: (err, attempt, total) => {
      console.error(`[交接缓冲] 取图失败(${attempt}/${total}):`, err);
    },
  });
}

/**
 * SSE 正常交付路径用的取图：同 `fetchPendingImage`，但保留三态结果。
 * `gone`（404）= 已被另一条路径取走，不重试、不打 error，由调用方走 `resolveSseGone` 收口；
 * 只有真失败（网络 / 5xx / 残缺）才在每次重试时 console.error。
 */
export function fetchPendingImageForSse(pendingId: string, attempts = 3): Promise<PendingFetchOutcome> {
  return fetchPendingImageOutcome(pendingId, {
    attempts,
    handshakeTimeoutMs: PENDING_FETCH_TIMEOUT_MS,
    onAttemptError: (err, attempt, total) => {
      console.error(`[交接缓冲] 取图失败(${attempt}/${total}):`, err);
    },
  });
}

/** SSE 路径取图 404 后的收口：核对本地是否已有该镜，没有再按 taskId 补拉兜底（详见 resolveSseGone）。 */
export function resolveSseGoneForTask(taskId: number, shotIndex: number) {
  return resolveSseGone(
    {
      hasLocalResult: async shot => {
        const persisted = shot > 0 ? shot : undefined;
        const found = await db.images
          .where('projectId').equals(taskId)
          .filter(i => i.type === 'result' && i.shotIndex === persisted)
          .first();
        return found !== undefined;
      },
      recover: shot => recoverPendingImages(taskId, [shot]),
      log: console,
    },
    shotIndex,
  );
}

/** 客户端已落 IndexedDB，通知服务端删掉缓冲行。删不掉也无妨，服务端有 TTL 兜底。 */
export async function releasePendingImage(pendingId: string): Promise<void> {
  try {
    await fetch(`/api/generation/pending/${pendingId}`, { method: 'DELETE' });
  } catch { /* 删不掉由 TTL 兜底，不影响用户 */ }
}

/**
 * 补拉：把服务端还留着、本地却没有的图捡回来。
 *
 * 这条路径专治「图已生成成功但没送达」：以前那种情况图就永久丢了（用户只能重新生成并再付
 * 一次钱），现在服务端会把图留在交接缓冲里，进任务页就能补回来。
 * 幂等：同一 shotIndex 本地已有 result 且内容一致才视为重复；内容不同＝新付费的图，旧图降级为备份。
 */
export function recoverPendingImages(
  taskId: number,
  expectedShotIndexes: readonly number[] = [],
): Promise<PendingRecoveryResult> {
  return recoverPending(
    {
      async listPending(id, signal) {
        const res = await fetch(`/api/generation/pending?taskId=${id}&includeAnchor=1`, {
          cache: 'no-store',
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { images } = await res.json() as { images: PendingMeta[] };
        return images;
      },
      fetchImage: pendingId =>
        fetchPendingImageOutcome(pendingId, {
          attempts: 3,
          handshakeTimeoutMs: PENDING_FETCH_TIMEOUT_MS,
          onAttemptError: (err, attempt, total) => {
            console.error(`[交接缓冲] 取图失败(${attempt}/${total}):`, err);
          },
        }),
      release: pendingId => { void releasePendingImage(pendingId); },
      store: {
        list: id => db.images.where('projectId').equals(id).toArray(),
        add: image => db.images.add(image as ImageItem),
        setType: (id, type) => db.images.update(id, { type: type as ImageItem['type'] }),
        remove: id => db.images.delete(id),
      },
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      attempts: PENDING_RECOVERY_ATTEMPTS,
      listTimeoutMs: PENDING_FETCH_TIMEOUT_MS,
      log: console,
    },
    taskId,
    expectedShotIndexes,
  );
}
// ===== [E] 看门狗与补拉 · 结束 =====