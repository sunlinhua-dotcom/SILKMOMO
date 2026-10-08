import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const { runMigration } = await import('../scripts/model-face-storage-migrate.mjs');
const { modelFaceObjectKeys } = await import('../lib/model-face-storage.ts');
const { ObjectNotFoundError } = await import('../lib/object-storage.ts');

const md5 = text => createHash('md5').update(text).digest('hex');
const b64 = text => Buffer.from(text).toString('base64');
const quiet = () => {};

/** 只认迁移脚本用到的几条 SQL 的内存假库，并记下每条语句。 */
function fakeDb(initialRows) {
  const rows = new Map(initialRows.map(r => [r.id, { imageKey: null, thumbnailKey: null, ...r }]));
  const statements = [];
  const query = async (text, params = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    statements.push(sql);
    if (sql.startsWith('SELECT count(*)')) {
      const toR2 = sql.includes('"imageKey" IS NULL');
      const hit = [...rows.values()].filter(r => (toR2 ? !r.imageKey && r.image : r.imageKey));
      return { rows: [{ n: hit.length, bytes: hit.reduce((n, r) => n + (r.image?.length ?? 0), 0) }] };
    }
    if (sql.startsWith('SELECT id')) {
      const toR2 = sql.includes('"imageKey" IS NULL');
      const [cursor, take] = params;
      const hit = [...rows.values()]
        .filter(r => r.id > cursor && (toR2 ? !r.imageKey && r.image : r.imageKey))
        .sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, take);
      return { rows: hit.map(r => ({ ...r })) };
    }
    if (sql.startsWith('UPDATE') && sql.includes('image = NULL')) {
      const [id, imageKey, thumbnailKey] = params;
      const row = rows.get(id);
      if (!row || row.imageKey || !row.image) return { rows: [], rowCount: 0 };
      Object.assign(row, { imageKey, thumbnailKey, image: null, thumbnail: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE')) {
      const [id, image, thumbnail, imageKey] = params;
      const row = rows.get(id);
      if (!row || row.imageKey !== imageKey) return { rows: [] };
      Object.assign(row, { image, thumbnail, imageKey: null, thumbnailKey: null });
      return {
        rows: [{ image_len: image.length, image_md5: md5(image), thumb_len: thumbnail.length, thumb_md5: md5(thumbnail) }],
      };
    }
    throw new Error(`假库不认识这条 SQL: ${sql}`);
  };
  return { rows, statements, query, tx: fn => fn(query) };
}

function memoryStorage({ corruptGet = false } = {}) {
  const objects = new Map();
  const log = { put: 0, get: 0, delete: 0 };
  return {
    objects, log,
    async put(key, body) { log.put++; objects.set(key, Buffer.from(body)); },
    async get(key) {
      log.get++;
      const body = objects.get(key);
      if (!body) throw new ObjectNotFoundError(key);
      return corruptGet ? Buffer.concat([body, Buffer.from('!')]) : body;
    },
    async delete(key) { log.delete++; objects.delete(key); },
  };
}

const common = { keysFor: modelFaceObjectKeys, makeThumbnail: async buf => Buffer.from(`thumb:${buf.length}`), log: quiet };
const seed = () => [
  { id: 'a1', userId: 'u1', image: b64('IMAGE-A'), thumbnail: b64('THUMB-A') },
  { id: 'b2', userId: 'u1', image: b64('IMAGE-B'), thumbnail: null },
];

test('dry-run 只做 SELECT 统计：不上传、不改库', async () => {
  const db = fakeDb(seed());
  const storage = memoryStorage();
  const report = await runMigration({ ...common, db, storage, mode: 'to-r2', apply: false });
  assert.equal(report.candidates, 2);
  assert.equal(report.migrated, 0);
  assert.equal(storage.log.put, 0);
  assert.ok(db.statements.every(s => s.startsWith('SELECT')), `dry-run 出现非 SELECT 语句: ${db.statements}`);
  assert.equal(db.rows.get('a1').image, b64('IMAGE-A'));
  assert.equal(db.rows.get('a1').imageKey, null);
  // to-db 的 dry-run 同样只读
  const back = await runMigration({ ...common, db, storage, mode: 'to-db', apply: false });
  assert.equal(back.candidates, 0);
  assert.ok(db.statements.every(s => s.startsWith('SELECT')));
});

test('--to-r2 --apply 后 --to-db --apply 往返，图片字节一致，缺缩略图的行补生成', async () => {
  const db = fakeDb(seed());
  const storage = memoryStorage();
  const out = await runMigration({ ...common, db, storage, mode: 'to-r2', apply: true, batchSize: 1 });
  assert.deepEqual([out.migrated, out.failed], [2, 0]);
  const a = db.rows.get('a1');
  assert.equal(a.image, null);
  assert.equal(a.thumbnail, null);
  assert.deepEqual([a.imageKey, a.thumbnailKey], [modelFaceObjectKeys('u1', 'a1').imageKey, modelFaceObjectKeys('u1', 'a1').thumbnailKey]);
  assert.equal(storage.objects.get(a.imageKey).toString(), 'IMAGE-A');
  assert.equal(db.rows.get('b2').imageKey !== null, true);

  // 重跑是幂等的：没有待迁移的行
  const again = await runMigration({ ...common, db, storage, mode: 'to-r2', apply: true });
  assert.equal(again.candidates, 0);

  const back = await runMigration({ ...common, db, storage, mode: 'to-db', apply: true });
  assert.deepEqual([back.migrated, back.failed], [2, 0]);
  assert.equal(db.rows.get('a1').image, b64('IMAGE-A'));
  assert.equal(db.rows.get('a1').thumbnail, b64('THUMB-A'));
  assert.equal(db.rows.get('a1').imageKey, null);
  assert.equal(db.rows.get('b2').image, b64('IMAGE-B'));
  assert.equal(storage.objects.size, 4, '默认回迁后保留对象存储里的对象');
});

test('回读校验不一致时：该行保持原样（不清列、不写 key），计入失败', async () => {
  const db = fakeDb(seed());
  const storage = memoryStorage({ corruptGet: true });
  const out = await runMigration({ ...common, db, storage, mode: 'to-r2', apply: true });
  assert.equal(out.failed, 2);
  assert.equal(out.migrated, 0);
  assert.equal(db.rows.get('a1').image, b64('IMAGE-A'));
  assert.equal(db.rows.get('a1').imageKey, null);
});

test('--limit 控制本次处理行数，--purge-objects 只在回迁成功后删对象', async () => {
  const db = fakeDb(seed());
  const storage = memoryStorage();
  const part = await runMigration({ ...common, db, storage, mode: 'to-r2', apply: true, limit: 1 });
  assert.equal(part.migrated, 1);
  await runMigration({ ...common, db, storage, mode: 'to-r2', apply: true });
  const back = await runMigration({ ...common, db, storage, mode: 'to-db', apply: true, purgeObjects: true });
  assert.equal(back.migrated, 2);
  assert.equal(storage.objects.size, 0);
});

test('--apply 缺少对象存储配置时直接报错，而不是悄悄跳过', async () => {
  const db = fakeDb(seed());
  await assert.rejects(runMigration({ ...common, db, storage: null, mode: 'to-r2', apply: true }), /OBJECT_STORAGE/);
});
