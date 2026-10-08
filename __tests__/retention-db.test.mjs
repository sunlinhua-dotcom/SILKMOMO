/**
 * 真实 PostgreSQL 上的保留清理 + 管理员充值幂等测试。
 *
 * 默认跳过（npm test 不连任何库）。要跑：先建一个临时库并灌入当前 schema，再
 *   RETENTION_TEST_DATABASE_URL=postgresql://.../silkmomo_scratch_xxx node --test __tests__/retention-db.test.mjs
 * 库名必须含 "scratch" 或 "test"，防止误指向正式库；测试会清空该库里的相关表。
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

const url = process.env.RETENTION_TEST_DATABASE_URL;
const dbName = url ? new URL(url).pathname.replace(/^\//, '') : '';
const enabled = !!url && /scratch|test/i.test(dbName);
if (url && !enabled) console.warn('[retention-db.test] 库名不含 scratch/test，拒绝运行:', dbName);
const skip = enabled ? false : 'set RETENTION_TEST_DATABASE_URL to a scratch/test database to run';

const DAY_MS = 24 * 60 * 60 * 1000;
const T = Date.parse('2026-10-08T00:00:00.000Z');
const ago = (days, extraMs = 0) => new Date(T - days * DAY_MS - extraMs);

let prisma;
let pool;
let retention;
let recharge;

if (enabled) {
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const pg = await import('pg');
  pool = new pg.default.Pool({ connectionString: url, max: 10 });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  retention = await import('../lib/retention.ts');
  recharge = await import('../lib/admin-recharge-core.ts');
}

async function reset() {
  await prisma.modelFaceGenerationItem.deleteMany();
  await prisma.modelFaceGenerationJob.deleteMany();
  await prisma.modelFace.deleteMany();
  await prisma.generationRecord.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.user.deleteMany();
}

async function makeUser(id, balanceFen = 0) {
  return prisma.user.create({ data: { id, username: id, passwordHash: 'x', balanceFen } });
}

const deps = (overrides = {}) => ({
  store: retention.createPrismaRetentionStore(prisma),
  lock: retention.createAdvisoryLock(prisma),
  config: { disabled: false, dryRun: false, generationRecordDays: 365, modelFaceJobDays: 30, batchSize: 500 },
  extraTasks: [],
  now: () => T,
  sleep: async () => {},
  ...overrides,
});

const record = (userId, label, createdAt, extra = {}) => prisma.generationRecord.create({
  data: { id: `rec-${label}`, userId, promptHash: label, promptText: label, createdAt, ...extra },
});

async function makeJob(userId, label, { status = 'completed', finishedAt, items = [] }) {
  const job = await prisma.modelFaceGenerationJob.create({
    data: { id: `job-${label}`, userId, status, requestedCount: items.length || 1, startSpecIndex: 0, costFen: 100, finishedAt, createdAt: finishedAt ?? ago(1) },
  });
  for (const [position, billingStatus] of items.entries()) {
    let faceId = null;
    if (billingStatus === 'kept') {
      const face = await prisma.modelFace.create({
        data: { id: `face-${label}-${position}`, userId, image: 'x', specIndex: 0, recipeLabel: 'r' },
      });
      faceId = face.id;
    }
    await prisma.modelFaceGenerationItem.create({
      data: { id: `item-${label}-${position}`, jobId: job.id, position, specIndex: 0, billingStatus, status: 'succeeded', faceId },
    });
  }
  return job;
}

const ids = async delegate => (await delegate.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(row => row.id);

test('GenerationRecord: purges only expired, unrated, feedback-free rows (boundary exact)', { skip }, async () => {
  await reset();
  await makeUser('u1');
  await record('u1', 'old-plain', ago(400));
  await record('u1', 'old-boundary-minus', ago(365, 1)); // 比保留期早 1ms：删
  await record('u1', 'old-boundary-exact', ago(365)); // 恰好 365 天：不删（严格小于才删）
  await record('u1', 'recent', ago(364));
  await record('u1', 'old-rated-good', ago(400), { rating: 1 });
  await record('u1', 'old-rated-bad', ago(400), { rating: -1 });
  await record('u1', 'old-feedback', ago(400), { feedback: '服装错误' });
  await record('u1', 'old-tags', ago(400), { feedbackTags: JSON.stringify(['光影差']) });
  await prisma.transaction.create({ data: { userId: 'u1', type: 'recharge', amountFen: 15000, balanceAfter: 15000, createdAt: ago(1000) } });

  const dry = await retention.runRetention(deps({ config: { ...deps().config, dryRun: true } }));
  assert.equal(dry.counts.generationRecord, 2);
  assert.equal((await ids(prisma.generationRecord)).length, 8, 'dry run must not delete');

  const summary = await retention.runRetention(deps());
  assert.equal(summary.counts.generationRecord, 2);
  assert.deepEqual(await ids(prisma.generationRecord), [
    'rec-old-boundary-exact', 'rec-old-feedback', 'rec-old-rated-bad', 'rec-old-rated-good', 'rec-old-tags', 'rec-recent',
  ]);
  assert.equal(await prisma.transaction.count(), 1, 'Transaction is never purged');
});

test('ModelFaceGenerationJob: refund_pending / charged jobs survive; ModelFace is never deleted', { skip }, async () => {
  await reset();
  await makeUser('u1');
  await makeJob('u1', 'kept-all', { finishedAt: ago(40), items: ['kept', 'kept', 'kept'] });
  await makeJob('u1', 'failed-refunded', { status: 'failed', finishedAt: ago(40), items: ['refunded', 'uncharged', 'kept'] });
  await makeJob('u1', 'refund-pending', { finishedAt: ago(40), items: ['kept', 'refund_pending'] });
  await makeJob('u1', 'charged-stranded', { status: 'failed', finishedAt: ago(40), items: ['charged'] });
  await makeJob('u1', 'running-old', { status: 'running', finishedAt: ago(40), items: ['kept'] });
  await makeJob('u1', 'queued-old', { status: 'queued', finishedAt: null, items: ['uncharged'] });
  await makeJob('u1', 'recent', { finishedAt: ago(10), items: ['kept'] });
  await makeJob('u1', 'no-finished-at', { finishedAt: null, items: ['kept'] });
  await makeJob('u1', 'boundary-exact', { finishedAt: ago(30), items: ['kept'] }); // 恰好 30 天：不删
  await makeJob('u1', 'boundary-minus', { finishedAt: ago(30, 1), items: ['kept'] }); // 早 1ms：删
  await makeJob('u1', 'empty-job', { finishedAt: ago(40), items: [] }); // 没有 item 的过期 job：删

  const facesBefore = await prisma.modelFace.count();
  assert.ok(facesBefore >= 7);

  const dry = await retention.runRetention(deps({ config: { ...deps().config, dryRun: true } }));
  assert.equal(dry.counts.modelFaceJob, 4);
  assert.equal(await prisma.modelFaceGenerationJob.count(), 11, 'dry run must not delete');

  const summary = await retention.runRetention(deps());
  assert.equal(summary.counts.modelFaceJob, 4);
  assert.deepEqual(await ids(prisma.modelFaceGenerationJob), [
    'job-boundary-exact', 'job-charged-stranded', 'job-no-finished-at', 'job-queued-old', 'job-recent', 'job-refund-pending', 'job-running-old',
  ]);
  // 被删 job 的 item 级联删除，保留 job 的 item 不动
  const remainingItems = await ids(prisma.modelFaceGenerationItem);
  assert.ok(!remainingItems.some(id => id.startsWith('item-kept-all') || id.startsWith('item-failed-refunded')));
  assert.ok(remainingItems.includes('item-refund-pending-1'));
  // 脸库资产一张都不能少
  assert.equal(await prisma.modelFace.count(), facesBefore);
});

test('batching on a real table: >500 expired rows are fully purged across several batches', { skip }, async () => {
  await reset();
  await makeUser('u1');
  await prisma.generationRecord.createMany({
    data: Array.from({ length: 1203 }, (_, i) => ({ id: `bulk-${i}`, userId: 'u1', promptHash: `h${i}`, promptText: 'p', createdAt: ago(500) })),
  });
  await record('u1', 'keep', ago(500), { rating: 1 });
  const sleeps = [];
  const summary = await retention.runRetention(deps({ sleep: async ms => { sleeps.push(ms); } }));
  assert.equal(summary.counts.generationRecord, 1203);
  assert.equal(sleeps.length, 2, '1203 rows = 500 + 500 + 203 → 两次批间停顿');
  assert.deepEqual(await ids(prisma.generationRecord), ['rec-keep']);
});

test('advisory lock: a run is skipped while another session holds the lock, and proceeds after release', { skip }, async () => {
  await reset();
  await makeUser('u1');
  await record('u1', 'old', ago(500));

  const holder = await pool.connect();
  try {
    await holder.query('SELECT pg_advisory_lock($1)', [retention.RETENTION_ADVISORY_LOCK_KEY]);
    const blocked = await retention.runRetention(deps());
    assert.equal(blocked.skipped, 'lock');
    assert.equal(await prisma.generationRecord.count(), 1, 'nothing deleted while locked');
  } finally {
    await holder.query('SELECT pg_advisory_unlock($1)', [retention.RETENTION_ADVISORY_LOCK_KEY]);
    holder.release();
  }

  const afterRelease = await retention.runRetention(deps());
  assert.equal(afterRelease.skipped, undefined);
  assert.equal(afterRelease.counts.generationRecord, 1);
  // 租约事务结束后锁必须已释放（否则下一轮永远抢不到）
  const probe = await pool.connect();
  try {
    const { rows } = await probe.query('SELECT pg_try_advisory_lock($1) AS locked', [retention.RETENTION_ADVISORY_LOCK_KEY]);
    assert.equal(rows[0].locked, true);
    await probe.query('SELECT pg_advisory_unlock($1)', [retention.RETENTION_ADVISORY_LOCK_KEY]);
  } finally {
    probe.release();
  }
});

test('two instances racing: exactly one performs the purge at a time (no double work, no error)', { skip }, async () => {
  await reset();
  await makeUser('u1');
  await prisma.generationRecord.createMany({
    data: Array.from({ length: 1500 }, (_, i) => ({ id: `race-${i}`, userId: 'u1', promptHash: `h${i}`, promptText: 'p', createdAt: ago(500) })),
  });
  const [a, b] = await Promise.all([
    retention.runRetention(deps({ sleep: () => new Promise(resolve => setTimeout(resolve, 20)) })),
    retention.runRetention(deps({ sleep: () => new Promise(resolve => setTimeout(resolve, 20)) })),
  ]);
  const total = (a.counts.generationRecord ?? 0) + (b.counts.generationRecord ?? 0);
  assert.equal(total, 1500);
  assert.equal(await prisma.generationRecord.count(), 0);
  assert.deepEqual(a.errors, {});
  assert.deepEqual(b.errors, {});
  assert.ok([a, b].some(summary => summary.skipped === 'lock'), 'the loser must be skipped by the lock');
});

test('admin recharge on a real database: concurrent same-requestId credits exactly once', { skip }, async () => {
  await reset();
  await makeUser('u1', 0);
  await makeUser('u2', 0);
  const req = '11111111-2222-4333-8444-555555555555';
  const input = { userId: 'u1', amountFen: 15000, description: '管理员充值', requestId: req };

  const results = await Promise.all(Array.from({ length: 8 }, () => recharge.rechargeWithIdempotency(prisma, input)));
  assert.ok(results.every(result => result.success), JSON.stringify(results));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal(results.filter(result => result.duplicate).length, 7);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).balanceFen, 15000);
  const ledger = await prisma.transaction.findMany({ where: { userId: 'u1' } });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].idempotencyKey, `admin-recharge:${req}`);

  // 之后重放：仍然只有一次
  const replay = await recharge.rechargeWithIdempotency(prisma, input);
  assert.deepEqual(replay, { success: true, balanceAfter: 15000, duplicate: true });

  // 不同 requestId 各加一次
  const other = await recharge.rechargeWithIdempotency(prisma, { ...input, requestId: '11111111-2222-4333-8444-666666666666' });
  assert.equal(other.balanceAfter, 30000);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } })).balanceFen, 30000);

  // 同 requestId 换用户：冲突，且 u2 余额不动
  const conflict = await recharge.rechargeWithIdempotency(prisma, { ...input, userId: 'u2' });
  assert.equal(conflict.conflict, true);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 'u2' } })).balanceFen, 0);
});

after(async () => {
  if (!enabled) return;
  await reset();
  await prisma.$disconnect();
  await pool.end();
});
