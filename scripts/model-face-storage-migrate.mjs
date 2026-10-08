#!/usr/bin/env node
/**
 * 模特脸图片在「数据库」与「对象存储（Cloudflare R2 等 S3 兼容）」之间搬家。
 *
 *   --to-r2   把库里 image / thumbnail 的 base64 上传到对象存储，校验后清空这两列、写入 key
 *   --to-db   反向回迁：从对象存储取回写进库，校验后清空 key（回滚前必须先跑这个）
 *
 * 默认 dry-run（只做 SELECT 统计，不上传、不改库）；加 --apply 才真正执行。
 *
 * 用法（需要 Node >= 22.18，直接加载 lib/*.ts）：
 *   DATABASE_URL=postgresql://... \
 *   OBJECT_STORAGE_ENDPOINT=... OBJECT_STORAGE_BUCKET=... \
 *   OBJECT_STORAGE_ACCESS_KEY_ID=... OBJECT_STORAGE_SECRET_ACCESS_KEY=... \
 *   node scripts/model-face-storage-migrate.mjs --to-r2            # 先看 dry-run 报告
 *   node scripts/model-face-storage-migrate.mjs --to-r2 --apply
 *
 * 选项：--batch N（每批行数，默认 50）--concurrency N（批内并发，默认 4）--limit N（本次最多处理 N 行）
 *       --purge-objects（仅 --to-db：回迁校验成功后删除对象存储里的对象，默认保留）
 *
 * 断点续跑：选行条件本身就排除已迁移的行（--to-r2 只选 imageKey 为空且 image 非空的行，--to-db 只选 imageKey 非空的行），
 * 中途中断直接重跑即可；单行失败只记录、不影响其它行，下次重跑会再试。
 * 每行校验：上传后立刻 GET 回来比对字节长度与 SHA-256，一致才清列；回迁写库后比对长度与 md5。
 * 不会打印任何图片内容或密钥。
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const md5 = text => createHash('md5').update(text).digest('hex');

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * @param {object} p
 * @param {{ query(text: string, params?: unknown[]): Promise<{ rows: any[], rowCount?: number }>, tx<T>(fn: (q: any) => Promise<T>): Promise<T> }} p.db
 * @param {{ put(key: string, body: Uint8Array, contentType: string): Promise<void>, get(key: string): Promise<Buffer>, delete(key: string): Promise<void> } | null} p.storage
 * @param {'to-r2'|'to-db'} p.mode
 */
export async function runMigration({
  db, storage, mode, apply = false, batchSize = 50, concurrency = 4, limit = Infinity,
  purgeObjects = false, keysFor, makeThumbnail, log = console.log,
}) {
  const report = { mode, apply, candidates: 0, candidateBytes: 0, migrated: 0, skipped: 0, failed: 0, failures: [] };
  const toR2 = mode === 'to-r2';

  const countSql = toR2
    ? `SELECT count(*)::int AS n, coalesce(sum(length(image)), 0)::bigint AS bytes
         FROM "ModelFace" WHERE "imageKey" IS NULL AND image IS NOT NULL`
    : `SELECT count(*)::int AS n, 0::bigint AS bytes FROM "ModelFace" WHERE "imageKey" IS NOT NULL`;
  const { rows: [counts] } = await db.query(countSql);
  report.candidates = Number(counts.n);
  report.candidateBytes = Number(counts.bytes);
  log(`[${mode}] 待处理 ${report.candidates} 行${toR2 ? `，库内 base64 约 ${(report.candidateBytes / 1048576).toFixed(1)} MiB` : ''}`);

  if (!apply) {
    log(`[${mode}] dry-run：未上传、未修改任何数据。加 --apply 才真正执行。`);
    return report;
  }
  if (!storage) throw new Error('--apply 需要完整的 OBJECT_STORAGE_* 环境变量');

  let cursor = '';
  let processed = 0;
  while (processed < limit) {
    const take = Math.min(batchSize, limit - processed);
    const selectSql = toR2
      ? `SELECT id, "userId", image, thumbnail FROM "ModelFace"
          WHERE "imageKey" IS NULL AND image IS NOT NULL AND id > $1 ORDER BY id LIMIT $2`
      : `SELECT id, "userId", "imageKey", "thumbnailKey" FROM "ModelFace"
          WHERE "imageKey" IS NOT NULL AND id > $1 ORDER BY id LIMIT $2`;
    const { rows } = await db.query(selectSql, [cursor, take]);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    processed += rows.length;

    await mapWithConcurrency(rows, concurrency, async row => {
      try {
        const outcome = toR2
          ? await rowToR2({ db, storage, row, keysFor, makeThumbnail })
          : await rowToDb({ db, storage, row, makeThumbnail, purgeObjects });
        if (outcome === 'migrated') report.migrated++; else report.skipped++;
      } catch (error) {
        report.failed++;
        const reason = error instanceof Error ? error.message : String(error);
        report.failures.push({ id: row.id, reason });
        log(`[${mode}] 失败 ${row.id}: ${reason}`);
      }
    });
    log(`[${mode}] 进度：已处理 ${processed}，成功 ${report.migrated}，跳过 ${report.skipped}，失败 ${report.failed}`);
  }
  log(`[${mode}] 完成：成功 ${report.migrated}，跳过 ${report.skipped}，失败 ${report.failed}${report.failed ? '（重跑同一命令会再试失败的行）' : ''}`);
  return report;
}

async function rowToR2({ db, storage, row, keysFor, makeThumbnail }) {
  const imageBytes = Buffer.from(row.image, 'base64');
  const thumbBytes = row.thumbnail ? Buffer.from(row.thumbnail, 'base64') : await makeThumbnail(imageBytes);
  const keys = keysFor(row.userId, row.id);

  await Promise.all([
    storage.put(keys.imageKey, imageBytes, 'image/jpeg'),
    storage.put(keys.thumbnailKey, thumbBytes, 'image/jpeg'),
  ]);
  const [backImage, backThumb] = await Promise.all([storage.get(keys.imageKey), storage.get(keys.thumbnailKey)]);
  if (backImage.length !== imageBytes.length || sha256(backImage) !== sha256(imageBytes)) {
    throw new Error('原图上传后回读校验不一致，库内数据保持不动');
  }
  if (backThumb.length !== thumbBytes.length || sha256(backThumb) !== sha256(thumbBytes)) {
    throw new Error('缩略图上传后回读校验不一致，库内数据保持不动');
  }

  const result = await db.query(
    `UPDATE "ModelFace"
        SET "imageKey" = $2, "thumbnailKey" = $3, image = NULL, thumbnail = NULL
      WHERE id = $1 AND "imageKey" IS NULL AND image IS NOT NULL`,
    [row.id, keys.imageKey, keys.thumbnailKey],
  );
  return (result.rowCount ?? 0) === 1 ? 'migrated' : 'skipped';
}

async function rowToDb({ db, storage, row, makeThumbnail, purgeObjects }) {
  const imageBytes = await storage.get(row.imageKey);
  let thumbBytes = null;
  if (row.thumbnailKey) {
    try {
      thumbBytes = await storage.get(row.thumbnailKey);
    } catch (error) {
      if (error?.name !== 'ObjectNotFoundError') throw error;
    }
  }
  thumbBytes ??= await makeThumbnail(imageBytes);
  const imageB64 = imageBytes.toString('base64');
  const thumbB64 = thumbBytes.toString('base64');

  const written = await db.tx(async q => {
    const result = await q(
      `UPDATE "ModelFace"
          SET image = $2, thumbnail = $3, "imageKey" = NULL, "thumbnailKey" = NULL
        WHERE id = $1 AND "imageKey" = $4
        RETURNING length(image)::int AS image_len, md5(image) AS image_md5,
                  length(thumbnail)::int AS thumb_len, md5(thumbnail) AS thumb_md5`,
      [row.id, imageB64, thumbB64, row.imageKey],
    );
    if (result.rows.length === 0) return null;
    const got = result.rows[0];
    if (got.image_len !== imageB64.length || got.image_md5 !== md5(imageB64)
      || got.thumb_len !== thumbB64.length || got.thumb_md5 !== md5(thumbB64)) {
      throw new Error('写回库后校验不一致，已回滚该行');
    }
    return got;
  });
  if (!written) return 'skipped';

  if (purgeObjects) {
    await Promise.allSettled([row.imageKey, row.thumbnailKey].filter(Boolean).map(key => storage.delete(key)));
  }
  return 'migrated';
}

// ───────────────────────── CLI ─────────────────────────

function parseArgs(argv) {
  const args = { mode: null, apply: false, batchSize: 50, concurrency: 4, limit: Infinity, purgeObjects: false };
  const numberArg = (name, value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} 需要正整数`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--to-r2') args.mode = 'to-r2';
    else if (arg === '--to-db') args.mode = 'to-db';
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--purge-objects') args.purgeObjects = true;
    else if (arg === '--batch') args.batchSize = numberArg('--batch', argv[++i]);
    else if (arg === '--concurrency') args.concurrency = numberArg('--concurrency', argv[++i]);
    else if (arg === '--limit') args.limit = numberArg('--limit', argv[++i]);
    else throw new Error(`未知参数：${arg}`);
  }
  if (!args.mode) throw new Error('必须指定 --to-r2 或 --to-db');
  if (args.purgeObjects && args.mode !== 'to-db') throw new Error('--purge-objects 只能和 --to-db 一起用');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRESQL_URL;
  if (!connectionString) throw new Error('缺少 DATABASE_URL');

  const [{ default: pg }, { readObjectStorageConfig, createObjectStorage }, { modelFaceObjectKeys }, { default: sharp }] = await Promise.all([
    import('pg'),
    import('../lib/object-storage.ts'),
    import('../lib/model-face-storage.ts'),
    import('sharp'),
  ]);

  const target = new URL(connectionString);
  console.log(`目标数据库：${target.hostname}:${target.port || 5432}${target.pathname}（${args.apply ? '--apply 真正执行' : 'dry-run'}）`);

  const config = readObjectStorageConfig();
  if (!config) console.log('提示：OBJECT_STORAGE_* 未配齐，只能做 dry-run。');
  const storage = config ? createObjectStorage(config) : null;
  if (config) console.log(`对象存储：${new URL(config.endpoint).host} / 桶 ${config.bucket}`);

  const pool = new pg.Pool({ connectionString, max: Math.max(2, args.concurrency + 1) });
  const db = {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn((text, params) => client.query(text, params));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const makeThumbnail = buffer => sharp(buffer).rotate().resize({ width: 256, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();

  try {
    const report = await runMigration({
      db, storage, mode: args.mode, apply: args.apply, batchSize: args.batchSize,
      concurrency: args.concurrency, limit: args.limit, purgeObjects: args.purgeObjects,
      keysFor: modelFaceObjectKeys, makeThumbnail,
    });
    process.exitCode = report.failed > 0 ? 2 : 0;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('迁移失败：', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
