import assert from 'node:assert/strict';
import test from 'node:test';

const jwt = await import('../lib/jwt-secret.ts');
const rl = await import('../lib/rate-limit.ts');
const shared = await import('../lib/auth-shared.ts');

// ───────── JWT 密钥：弱值判定 + 告警（不抛错，不泄露密钥） ─────────

test('isWeakJwtSecret 判定示例值、短值、占位符为弱', () => {
  assert.equal(jwt.isWeakJwtSecret(undefined), true);
  assert.equal(jwt.isWeakJwtSecret(''), true);
  assert.equal(jwt.isWeakJwtSecret('short-secret'), true);
  // 旧 .env.example 里的示例值（长度 ≥32 也必须判弱）
  assert.equal(jwt.isWeakJwtSecret('silkmomo-jwt-secret-change-me-in-production-2026'), true);
  assert.equal(jwt.isWeakJwtSecret('silkmomo-admin-setup-2026'), true);
  // 新的占位符
  assert.equal(jwt.isWeakJwtSecret('please-generate-with-openssl-rand-base64-48'), true);
  assert.equal(jwt.isWeakJwtSecret('a'.repeat(64)), true);
  // 合格的随机密钥
  assert.equal(jwt.isWeakJwtSecret('k3Jx9Qm2Zt7VbN4wRy8LpD1sFh6GcA0uEoXiTq5YnBzM'), false);
});

test('getJwtSecret 在 production 下遇到弱密钥只告警不抛错，且日志不含密钥', () => {
  const saved = { ...process.env };
  const weak = 'silkmomo-jwt-secret-change-me-in-production-2026';
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PHASE;
    process.env.JWT_SECRET = weak;
    let secret;
    assert.doesNotThrow(() => { secret = jwt.getJwtSecret(); });
    assert.ok(secret instanceof Uint8Array && secret.length > 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /安全告警/);
    assert.ok(!errors[0].includes(weak), '告警不得打印密钥本身');
  } finally {
    console.error = origError;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('production 下完全没设置 JWT_SECRET 仍然抛错', () => {
  const saved = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PHASE;
    delete process.env.JWT_SECRET;
    assert.throws(() => jwt.getJwtSecret(), /JWT_SECRET/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

// ───────── 限流：用户名+IP 维度、桶上限、IP 提取 ─────────

test('登录锁定 key 按 用户名+IP 区分：攻击者锁不了别的 IP 上的 admin', () => {
  rl.__resetAllBuckets();
  const attacker = rl.loginLockKey('Admin', '1.1.1.1');
  const realAdmin = rl.loginLockKey('admin', '2.2.2.2');
  assert.notEqual(attacker, realAdmin);
  // 大小写归一
  assert.equal(rl.loginLockKey('ADMIN', '1.1.1.1'), attacker);

  for (let i = 0; i < 5; i++) rl.bumpRateLimit(attacker, 60_000);
  assert.equal(rl.isRateLimited(attacker, 5, 60_000).allowed, false);
  assert.equal(rl.isRateLimited(realAdmin, 5, 60_000).allowed, true);

  rl.resetRateLimit(attacker);
  assert.equal(rl.isRateLimited(attacker, 5, 60_000).allowed, true);
});

test('rateLimitByKey 按 scope+id 独立计数，超限给出 retryAfterSec', () => {
  rl.__resetAllBuckets();
  for (let i = 0; i < 3; i++) assert.equal(rl.rateLimitByKey('ai-chat', 'u1', 3, 60_000).allowed, true);
  const blocked = rl.rateLimitByKey('ai-chat', 'u1', 3, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60);
  assert.equal(rl.rateLimitByKey('ai-chat', 'u2', 3, 60_000).allowed, true);
  assert.equal(rl.rateLimitByKey('ai-analyze', 'u1', 3, 60_000).allowed, true);
});

test('桶数量有硬上限，超出按 LRU 淘汰最久未访问的', () => {
  rl.__resetAllBuckets();
  for (let i = 0; i < rl.MAX_BUCKETS + 500; i++) rl.rateLimit(`rand:${i}`, 5, 60_000);
  assert.ok(rl.__bucketCount() <= rl.MAX_BUCKETS, `桶数 ${rl.__bucketCount()} 超过上限`);
  // 最新的 key 还在（计数连续），最老的已被淘汰（重新开始计数）
  const newest = rl.rateLimit(`rand:${rl.MAX_BUCKETS + 499}`, 5, 60_000);
  assert.equal(newest.remaining, 3); // 之前已计 1 次，这次是第 2 次
  const oldest = rl.rateLimit('rand:0', 5, 60_000);
  assert.equal(oldest.remaining, 4); // 被淘汰后重新计第 1 次
  rl.__resetAllBuckets();
});

test('extractClientIp 按可信跳数从右取，不信任 XFF 最左侧的伪造值', () => {
  assert.equal(rl.extractClientIp('6.6.6.6, 9.9.9.9', null, 1), '9.9.9.9');
  assert.equal(rl.extractClientIp('6.6.6.6, 9.9.9.9, 10.0.0.1', null, 2), '9.9.9.9');
  assert.equal(rl.extractClientIp('9.9.9.9', null, 3), '9.9.9.9');
  assert.equal(rl.extractClientIp(null, '7.7.7.7', 1), '7.7.7.7');
  assert.equal(rl.extractClientIp(null, null, 1), 'unknown');
  assert.equal(rl.extractClientIp('1.1.1.1', null, 0), '1.1.1.1'); // 非法 hops 回落到 1
});

// ───────── proxy 路径判断 ─────────

test('classifyPath：静态资源只放行白名单，点号动态路由不能绕过', () => {
  const c = shared.classifyPath;
  assert.equal(c('/_next/static/chunks/a.js'), 'asset');
  assert.equal(c('/favicon.ico'), 'asset');
  assert.equal(c('/icon.svg'), 'asset');
  assert.equal(c('/presets/a.jpg'), 'asset');
  assert.equal(c('/logo.SVG'), 'asset');
  // 以前 includes('.') 会放行下面这些
  assert.equal(c('/task/abc.def'), 'protected');
  assert.equal(c('/admin/users.json'), 'protected');
  assert.equal(c('/api/model-faces.png'), 'protected');
  assert.equal(c('/api/generate/stream.js'), 'protected');
  assert.equal(c('/lookbook.html'), 'protected');
  assert.equal(c('/.env'), 'protected');
  assert.equal(c('/foo.'), 'protected');
});

test('classifyPath：公共页面 / 公共 API 精确匹配，logo-preview 已不公开', () => {
  const c = shared.classifyPath;
  assert.equal(c('/login'), 'public-page');
  assert.equal(c('/register'), 'public-page');
  assert.equal(c('/login/'), 'public-page');
  assert.equal(c('/logo-preview'), 'protected');
  assert.equal(c('/api/health'), 'public-api');
  assert.equal(c('/api/auth/login'), 'public-api');
  assert.equal(c('/api/auth/register'), 'public-api');
  assert.equal(c('/api/admin/setup'), 'public-api');
  assert.equal(c('/api/auth/login-evil'), 'protected');
  assert.equal(c('/api/health/secret'), 'protected');
  assert.equal(c('/api/auth/me'), 'protected');
  assert.equal(c('/api/auth/logout'), 'protected');
  assert.equal(c('/'), 'protected');
});

// ───────── next 参数 ─────────

test('isSafeNextPath / safeNextPath 只接受站内路径', () => {
  const ok = ['/', '/lookbook', '/task/abc?x=1&y=2', '/tasks#top'];
  for (const p of ok) assert.equal(shared.isSafeNextPath(p), true, p);
  const bad = ['//evil.com', '//evil.com/x', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com',
    'evil.com', '', '/a\nb', '/a\u0000b', null, undefined, 42, {}, '/' + 'a'.repeat(3000)];
  for (const p of bad) assert.equal(shared.isSafeNextPath(p), false, String(p));

  assert.equal(shared.safeNextPath('/lookbook?a=1'), '/lookbook?a=1');
  assert.equal(shared.safeNextPath('//evil.com'), '/');
  assert.equal(shared.safeNextPath('/login?next=/x'), '/');
  assert.equal(shared.safeNextPath('/register', '/home'), '/home');
  assert.equal(shared.safeNextPath(undefined), '/');
});

test('buildLoginRedirectPath 编码原路径 + query，且结果能被 safeNextPath 还原', () => {
  const url = shared.buildLoginRedirectPath('/task/abc', '?a=1&b=中文');
  assert.ok(url.startsWith('/login?next='));
  const next = new URL(url, 'http://x').searchParams.get('next');
  assert.equal(next, '/task/abc?a=1&b=中文');
  assert.equal(shared.safeNextPath(next), next);
  assert.equal(shared.buildLoginRedirectPath('/', ''), '/login');
});

// ───────── 入参校验 ─────────

test('validateRegisterInput：类型与长度校验', () => {
  const v = shared.validateRegisterInput;
  assert.equal(v({ username: 'alice_01', password: 'abcd1234' }).ok, true);
  assert.deepEqual(v({ username: 'alice', password: 'abcd1234', name: '  小明 ' }).value.name, '小明');
  for (const body of [
    null, [], 'str',
    { username: 123, password: 'abcd1234' },
    { username: 'alice', password: ['abcd1234'] },
    { username: 'a', password: 'abcd1234' },
    { username: 'bad name', password: 'abcd1234' },
    { username: 'alice', password: 'abc123' },
    { username: 'alice', password: 'a1' + 'x'.repeat(200) },
    { username: 'alice', password: 'abcdefgh' },
    { username: 'alice', password: 'abcd1234', name: 5 },
    { username: 'alice', password: 'abcd1234', name: 'n'.repeat(33) },
  ]) {
    const r = v(body);
    assert.equal(r.ok, false, JSON.stringify(body)?.slice(0, 60));
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  }
});

test('validateLoginInput：必须是字符串，超长拒绝', () => {
  const v = shared.validateLoginInput;
  assert.equal(v({ username: 'alice', password: 'whatever' }).ok, true);
  assert.equal(v({ username: { $ne: '' }, password: 'x' }).ok, false);
  assert.equal(v({ username: 'alice', password: 123 }).ok, false);
  assert.equal(v({ username: '', password: 'x' }).ok, false);
  assert.equal(v({ username: 'u'.repeat(65), password: 'x' }).ok, false);
  assert.equal(v(null).ok, false);
});

test('validateLoginInput：登录密码上限只防滥用，超过注册上限的老密码仍能登录', () => {
  const v = shared.validateLoginInput;
  assert.ok(shared.LOGIN_PASSWORD_MAX > shared.PASSWORD_MAX);
  assert.equal(v({ username: 'alice', password: 'p'.repeat(shared.PASSWORD_MAX + 1) }).ok, true);
  assert.equal(v({ username: 'alice', password: 'p'.repeat(shared.LOGIN_PASSWORD_MAX) }).ok, true);
  assert.equal(v({ username: 'alice', password: 'p'.repeat(shared.LOGIN_PASSWORD_MAX + 1) }).ok, false);
  // 老账号可能是 6 位及更短的旧规则密码、或含不合规字符的用户名：登录不套注册规则
  assert.equal(v({ username: 'old user.1', password: '123456' }).ok, true);
  // 注册仍是 8–128
  assert.equal(shared.validateRegisterInput({ username: 'alice', password: 'a1' + 'x'.repeat(127) }).ok, false);
  assert.equal(shared.validateRegisterInput({ username: 'alice', password: 'a1' + 'x'.repeat(126) }).ok, true);
});

test('getUsernameIssue / getPasswordIssue 与服务端注册规则一致', () => {
  const { getUsernameIssue: u, getPasswordIssue: p, validateRegisterInput: reg } = shared;
  assert.equal(u(''), null);
  for (const name of ['a', 'bad name', '中文名', 'x'.repeat(33)]) assert.ok(u(name), name);
  for (const name of ['ab', 'alice_01', 'a-b', 'x'.repeat(32)]) assert.equal(u(name), null, name);
  assert.equal(p(''), null);
  for (const pw of ['abc12', 'abcdefgh', '12345678', 'a1' + 'x'.repeat(200)]) assert.ok(p(pw), pw.slice(0, 12));
  assert.equal(p('abcd1234'), null);
  // 前端判定与服务端判定逐项吻合，避免前端放行、后端又拒
  for (const [user, pw] of [['alice', 'abcd1234'], ['a', 'abcd1234'], ['alice', 'abc123'], ['bad name', 'abcd1234'], ['alice', 'abcdefgh']]) {
    assert.equal(!u(user) && !p(pw), reg({ username: user, password: pw }).ok, `${user}/${pw}`);
  }
});

test('describeAuthFailure：区分 429 / 业务拒绝 / 服务端错误 / 非 JSON', () => {
  const d = shared.describeAuthFailure;
  // 429 后端文案已带秒数：原样
  const a = d(429, { error: '请求过于频繁，请 12 秒后再试' }, '12');
  assert.equal(a.kind, 'rate-limited');
  assert.equal(a.message, '请求过于频繁，请 12 秒后再试');
  assert.equal(a.retryAfterSec, 12);
  // 文案没带秒数：用 Retry-After 补
  assert.match(d(429, { error: '操作太快' }, '30').message, /请 30 秒后再试/);
  // 429 非 JSON（网关限流页）
  assert.match(d(429, null, '5').message, /请 5 秒后再试/);
  assert.equal(d(429, null, null).kind, 'rate-limited');
  // 400 / 401 显示后端 error
  assert.deepEqual(d(401, { error: '用户名或密码错误' }, null), { kind: 'rejected', message: '用户名或密码错误' });
  assert.equal(d(400, { error: '请求体解析失败' }, null).message, '请求体解析失败');
  // 非 JSON 的 502 / 400 不能报成「网络错误」
  const b = d(502, null, null);
  assert.equal(b.kind, 'server');
  assert.match(b.message, /502/);
  assert.doesNotMatch(b.message, /网络/);
  assert.equal(d(400, '<html>', null).kind, 'server');
  assert.equal(d(500, { error: '登录失败，请稍后重试' }, null).message, '登录失败，请稍后重试');
});

test('postAuthJson：网络失败 / 非 JSON 响应 / 成功', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const net = await shared.postAuthJson('/x', {});
    assert.equal(net.ok, false);
    assert.equal(net.failure.kind, 'network');

    globalThis.fetch = async () => new Response('<html>Bad Gateway</html>', { status: 502 });
    const bad = await shared.postAuthJson('/x', {});
    assert.equal(bad.failure.kind, 'server');
    assert.match(bad.failure.message, /502/);

    globalThis.fetch = async () => new Response('not json', { status: 200 });
    assert.equal((await shared.postAuthJson('/x', {})).failure.kind, 'server');

    globalThis.fetch = async () => new Response(JSON.stringify({ error: '稍后' }), { status: 429, headers: { 'Retry-After': '9' } });
    const rl = await shared.postAuthJson('/x', {});
    assert.equal(rl.failure.kind, 'rate-limited');
    assert.equal(rl.failure.retryAfterSec, 9);

    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, user: { username: 'a' } }), { status: 200 });
    const ok = await shared.postAuthJson('/x', {});
    assert.equal(ok.ok, true);
    assert.equal(ok.data.user.username, 'a');
  } finally {
    globalThis.fetch = realFetch;
  }
});
