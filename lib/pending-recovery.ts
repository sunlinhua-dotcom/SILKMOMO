import { db } from '@/lib/db';
import { compressImage } from '@/lib/image-compressor';
import { fetchPendingImageWithRetry } from '@/lib/pending-fetch';

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
export interface PendingRecoveryResult {
  ok: boolean;
  recoveredShotIndexes: number[];
}

export async function recoverPendingImages(
  taskId: number,
  expectedShotIndexes: readonly number[] = [],
): Promise<PendingRecoveryResult> {
  const recoveredShotIndexes: number[] = [];
  for (let attempt = 0; attempt < PENDING_RECOVERY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PENDING_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/generation/pending?taskId=${taskId}&includeAnchor=1`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { images } = await res.json() as {
        images: Array<{ id: string; kind: string; shotIndex: number; width: number; height: number }>;
      };
      if (!Array.isArray(images)) throw new Error('响应缺少待取图片列表');

      const local = await db.images.where('projectId').equals(taskId).toArray();
      for (const meta of images) {
        if (meta.kind === 'anchor') {
          const existingAnchor = local.find(i => i.type === 'anchor');
          if (existingAnchor) {
            void releasePendingImage(meta.id);
            continue;
          }
          const fetchedAnchor = await fetchPendingImage(meta.id);
          if (!fetchedAnchor) {
            console.error(`[交接缓冲] 身份锚 ${meta.id} 未能取回，继续并回退首张成功图`);
            continue;
          }
          try {
            await db.images.add({
              projectId: taskId,
              type: 'anchor',
              data: fetchedAnchor.data,
              mimeType: fetchedAnchor.mimeType || 'image/png',
            });
            local.push({
              projectId: taskId,
              type: 'anchor',
              data: fetchedAnchor.data,
              mimeType: fetchedAnchor.mimeType || 'image/png',
            });
            void releasePendingImage(meta.id);
          } catch (error) {
            console.error('[交接缓冲] 身份锚落库失败，继续并回退首张成功图:', error);
          }
          continue;
        }
        const persistedShotIndex = meta.shotIndex > 0 ? meta.shotIndex : undefined;
        const existingResult = local.find(i => i.type === 'result' && i.shotIndex === persistedShotIndex);
        // 本地同镜次已有 result，不等于这张 pending 是它的重复：
        // 用户重做某镜次并付费后，若这一轮没送达，生成收尾会先把旧图（result_backup）还原成 result，
        // 随后补拉发现「同 shotIndex 已有 result」——旧逻辑直接 DELETE，等于把刚付费的新图丢了。
        // 所以先把 pending 取回来比对内容：一模一样才是重复（释放即可）；不一样就是新付费的图，
        // 旧图降级为 result_backup（保留可还原），新图作为 result 入库。
        const fetched = await fetchPendingImage(meta.id);
        if (!fetched) throw new Error(`待取图片 ${meta.id} 未能取回`);
        if (existingResult) {
          if (existingResult.data === fetched.data) {
            void releasePendingImage(meta.id);
            continue;
          }
          const staleBackups = await db.images
            .where('projectId').equals(taskId)
            .filter(i => i.type === 'result_backup' && i.shotIndex === persistedShotIndex)
            .toArray();
          for (const backup of staleBackups) {
            if (backup.id !== undefined) await db.images.delete(backup.id);
          }
          if (existingResult.id !== undefined) {
            await db.images.update(existingResult.id, { type: 'result_backup' });
          }
          existingResult.type = 'result_backup';
        }
        await db.images.add({
          projectId: taskId,
          type: 'result',
          data: fetched.data,
          mimeType: fetched.mimeType || 'image/png',
          shotIndex: persistedShotIndex,
          imageType: 'hero',
          index: meta.shotIndex,
        });
        local.push({
          projectId: taskId,
          type: 'result',
          data: fetched.data,
          mimeType: fetched.mimeType || 'image/png',
          shotIndex: persistedShotIndex,
        });
        recoveredShotIndexes.push(meta.shotIndex);
        void releasePendingImage(meta.id);
      }

      if (expectedShotIndexes.length > 0) {
        // 仅诊断：缺口的补齐交给生成路径（recoveryGate / finalizeGeneration），这里不据此改库
        const haveShots = new Set(local.filter(i => i.type === 'result').map(i => i.shotIndex ?? 0));
        const stillMissing = expectedShotIndexes.filter(shot => !haveShots.has(shot));
        if (stillMissing.length > 0) {
          console.log(`[交接缓冲] 补拉后本地仍缺镜次 ${stillMissing.join(',')}，交给生成路径处理`);
        }
      }
      if (recoveredShotIndexes.length > 0) {
        console.log(`[交接缓冲] 补回 ${recoveredShotIndexes.length} 张此前未送达的图`);
      }
      // 列表成功且其中的结果都已处理，说明当前没有更多可补；缺口应交给生成路径，
      // 不能为了等一个尚不存在的 pending 固定空转三轮。
      return { ok: true, recoveredShotIndexes };
    } catch (err) {
      console.error(`[交接缓冲] 补拉失败(${attempt + 1}/${PENDING_RECOVERY_ATTEMPTS}):`, err);
      if (attempt === PENDING_RECOVERY_ATTEMPTS - 1) {
        return { ok: false, recoveredShotIndexes };
      }
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < PENDING_RECOVERY_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return { ok: true, recoveredShotIndexes };
}
// ===== [E] 看门狗与补拉 · 结束 =====