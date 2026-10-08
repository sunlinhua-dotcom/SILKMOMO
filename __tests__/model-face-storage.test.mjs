import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const {
  ModelFaceStorageUnavailableError, deleteModelFaceObjects, modelFaceObjectKeys,
  newModelFaceId, readModelFaceBytes, uploadModelFaceImages,
} = await import('../lib/model-face-storage.ts');
const { ObjectNotFoundError } = await import('../lib/object-storage.ts');

function memoryStorage({ failPut = false, failDelete = false, failGet = false } = {}) {
  const objects = new Map();
  const log = { puts: [], deletes: [], gets: [] };
  return {
    objects, log,
    async put(key, body) {
      log.puts.push(key);
      if (failPut && log.puts.length === 2) throw new Error('boom');
      objects.set(key, Buffer.from(body));
    },
    async get(key) {
      log.gets.push(key);
      if (failGet) throw new Error('down');
      if (!objects.has(key)) throw new ObjectNotFoundError(key);
      return objects.get(key);
    },
    async delete(key) {
      log.deletes.push(key);
      if (failDelete) throw new Error('nope');
      objects.delete(key);
    },
  };
}
const quiet = { warn() {} };
const input = {
  userId: 'user_1',
  faceId: 'face_1',
  image: Buffer.from('IMG').toString('base64'),
  thumbnail: Buffer.from('THUMB').toString('base64'),
};

test('key 形如 model-faces/<userId>/<faceId>/{image,thumb}.jpg，且不会被特殊字符带出目录', () => {
  assert.deepEqual(modelFaceObjectKeys('u1', 'f1'), {
    imageKey: 'model-faces/u1/f1/image.jpg',
    thumbnailKey: 'model-faces/u1/f1/thumb.jpg',
  });
  assert.equal(modelFaceObjectKeys('../x', 'a/b').imageKey, 'model-faces/___x/a_b/image.jpg');
  assert.match(newModelFaceId(), /^c[a-z0-9]{24}$/);
});

test('存储未启用：不上传、返回 null（调用方存库，行为同改造前）', async () => {
  assert.equal(await uploadModelFaceImages(input, null, quiet), null);
});

test('上传成功：返回 key，对象内容与输入字节一致', async () => {
  const storage = memoryStorage();
  const keys = await uploadModelFaceImages(input, storage, quiet);
  assert.deepEqual(keys, modelFaceObjectKeys('user_1', 'face_1'));
  assert.equal(storage.objects.get(keys.imageKey).toString(), 'IMG');
  assert.equal(storage.objects.get(keys.thumbnailKey).toString(), 'THUMB');
});

test('上传失败：返回 null 让调用方回退存库，并清掉已传上去的半份对象', async () => {
  const storage = memoryStorage({ failPut: true });
  const warnings = [];
  const keys = await uploadModelFaceImages(input, storage, { warn: (...a) => warnings.push(a.join(' ')) });
  assert.equal(keys, null);
  assert.equal(storage.objects.size, 0);
  assert.equal(storage.log.deletes.length, 2);
  assert.ok(warnings.some(w => w.includes('回退存库')));
});

test('读取优先 key：key 与库内 base64 同时存在时取对象存储', async () => {
  const storage = memoryStorage();
  storage.objects.set('k/image.jpg', Buffer.from('FROM-R2'));
  const bytes = await readModelFaceBytes({ key: 'k/image.jpg', inline: Buffer.from('FROM-DB').toString('base64') }, storage);
  assert.equal(bytes.toString(), 'FROM-R2');
  const inline = await readModelFaceBytes({ key: null, inline: Buffer.from('FROM-DB').toString('base64') }, null);
  assert.equal(inline.toString(), 'FROM-DB');
});

test('key 行遇到存储未启用 / 对象缺失 / 存储故障：抛带原因的明确错误而不是崩溃', async () => {
  await assert.rejects(readModelFaceBytes({ key: 'k', inline: null }, null),
    e => e instanceof ModelFaceStorageUnavailableError && e.reason === 'not-configured');
  await assert.rejects(readModelFaceBytes({ key: 'k', inline: null }, memoryStorage()),
    e => e instanceof ModelFaceStorageUnavailableError && e.reason === 'missing');
  await assert.rejects(readModelFaceBytes({ key: 'k', inline: null }, memoryStorage({ failGet: true })),
    e => e instanceof ModelFaceStorageUnavailableError && e.reason === 'failed');
  await assert.rejects(readModelFaceBytes({ key: null, inline: null }, memoryStorage()), ModelFaceStorageUnavailableError);
});

test('删除尽力而为：对象存储报错只记日志、不抛；未启用时也不抛', async () => {
  const storage = memoryStorage({ failDelete: true });
  const warnings = [];
  await deleteModelFaceObjects({ imageKey: 'a', thumbnailKey: 'b' }, storage, { warn: (...a) => warnings.push(a.join(' ')) });
  assert.equal(storage.log.deletes.length, 2);
  assert.equal(warnings.length, 2);
  await deleteModelFaceObjects({ imageKey: 'a', thumbnailKey: null }, null, quiet);
  await deleteModelFaceObjects({ imageKey: null, thumbnailKey: null }, storage, quiet);
});

test('接线检查：路由与任务都走统一读写入口，schema / 迁移 / 依赖符合约定', () => {
  const library = fs.readFileSync('lib/model-face-library.ts', 'utf8');
  const route = fs.readFileSync('app/api/model-faces/[id]/route.ts', 'utf8');
  const jobs = fs.readFileSync('lib/model-face-jobs.ts', 'utf8');
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const migration = fs.readFileSync('prisma/migrations/20261008200000_model_face_object_storage/migration.sql', 'utf8');

  // 读：库里每个读 image 列的 select 旁边都带着 imageKey，并经过 readModelFaceBytes
  assert.ok((library.match(/image: true/g) || []).length <= (library.match(/imageKey: true/g) || []).length);
  assert.ok((library.match(/readModelFaceBytes\(/g) || []).length >= 4);
  assert.match(route, /deleteModelFace\(/);
  assert.doesNotMatch(route, /modelFace\.deleteMany/);
  assert.match(route, /status: 503/);
  // 写：事务外上传、事务失败清理
  assert.match(jobs, /persistPreparedModelFaceImages[\s\S]*prisma\.\$transaction[\s\S]*discardUnstoredModelFaceImages/);
  // schema 与迁移
  assert.match(schema, /image\s+String\?/);
  assert.match(schema, /imageKey\s+String\?/);
  assert.match(schema, /thumbnailKey\s+String\?/);
  const statements = migration.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
  assert.equal(statements.length, 3);
  assert.ok(statements.every(l => /ADD COLUMN|DROP NOT NULL/.test(l)), '迁移只允许 ADD COLUMN / DROP NOT NULL');
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|DELETE|UPDATE|TRUNCATE/i);
  // 依赖：aws4fetch 精确版本，不引 aws-sdk
  assert.match(pkg.dependencies.aws4fetch, /^\d+\.\d+\.\d+$/);
  assert.equal(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(n => n.startsWith('@aws-sdk')).length, 0);
});
