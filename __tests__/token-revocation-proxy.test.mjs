import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 直接加载真实的 proxy.ts 来验证「已登出的令牌 → API 401 / 页面跳登录；老 token 照常通过」。
 * proxy.ts 的相对导入没写扩展名（给 bundler 用的），node 直接跑需要一个解析钩子补 .ts；
 * 另外把 ./lib/token-revocation（依赖 prisma / 数据库）换成纯内存替身。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stubUrl = pathToFileURL(path.join(root, '__tests__/fixtures/token-revocation-stub.mjs')).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\/lib\/token-revocation$/.test(specifier) && context.parentURL?.endsWith('/proxy.ts')) {
      return { url: stubUrl, shortCircuit: true };
    }
    if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      if (existsSync(`${base}.ts`)) return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true };
    }
    // next 的 package.json 没有 exports 映射，node 直跑 ESM 解析不了 'next/server'，指到实际文件
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    return nextResolve(specifier, context);
  },
});

process.env.JWT_SECRET = 'k3Jx9Qm2Zt7VbN4wRy8LpD1sFh6GcA0uEoXiTq5YnBzM';
const { SignJWT } = await import('jose');
const { NextRequest } = await import('next/server.js');
const { proxy } = await import('../proxy.ts');

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

async function sign({ jti, expSec } = {}) {
  let jwt = new SignJWT({ userId: 'u1', username: 'alice', role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expSec ?? '7d');
  if (jti) jwt = jwt.setJti(jti);
  return jwt.sign(secret);
}

function req(pathname, token) {
  const headers = token ? { cookie: `silkmomo_token=${token}` } : {};
  return new NextRequest(`http://localhost:4605${pathname}`, { headers });
}

test.beforeEach(() => {
  globalThis.__stubRevokedJtis = new Set();
  globalThis.__stubRevocationShouldThrow = false;
});

test('有效且未吊销的新 token：API 与页面都放行', async () => {
  const token = await sign({ jti: 'j-ok' });
  const api = await proxy(req('/api/auth/me', token));
  assert.equal(api.status, 200);
  assert.equal(api.headers.get('x-middleware-next'), '1');
  const page = await proxy(req('/lookbook', token));
  assert.equal(page.headers.get('x-middleware-next'), '1');
});

test('登出（jti 被吊销）后：API 返回 401 并清 cookie', async () => {
  const token = await sign({ jti: 'j-revoked' });
  assert.equal((await proxy(req('/api/model-faces', token))).status, 200);
  globalThis.__stubRevokedJtis.add('j-revoked');
  const res = await proxy(req('/api/model-faces', token));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('set-cookie') ?? '', /silkmomo_token=;/);
});

test('登出后：受保护页面跳转 /login', async () => {
  const token = await sign({ jti: 'j-revoked-page' });
  globalThis.__stubRevokedJtis.add('j-revoked-page');
  const res = await proxy(req('/lookbook', token));
  assert.ok([302, 307, 308].includes(res.status), `状态 ${res.status}`);
  assert.match(res.headers.get('location') ?? '', /\/login/);
});

test('登出后访问 /login 不会被当成已登录而弹回 /（避免重定向死循环）', async () => {
  const token = await sign({ jti: 'j-revoked-login' });
  const before = await proxy(req('/login', token));
  assert.ok([302, 307, 308].includes(before.status), '未吊销时已登录用户访问 /login 会回首页');
  globalThis.__stubRevokedJtis.add('j-revoked-login');
  const after = await proxy(req('/login', token));
  assert.equal(after.headers.get('x-middleware-next'), '1');
});

test('老 token（没有 jti，上线前签发）继续有效', async () => {
  const token = await sign({}); // 无 jti
  // 即使吊销集合里有东西，也与它无关
  globalThis.__stubRevokedJtis.add('j-someone-else');
  const res = await proxy(req('/api/auth/me', token));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-middleware-next'), '1');
});

test('只吊销一枚令牌，同一用户的另一枚（别的设备 / 新登录）不受影响', async () => {
  const a = await sign({ jti: 'j-a' });
  const b = await sign({ jti: 'j-b' });
  globalThis.__stubRevokedJtis.add('j-a');
  assert.equal((await proxy(req('/api/auth/me', a))).status, 401);
  assert.equal((await proxy(req('/api/auth/me', b))).status, 200);
});

test('已过期的 token 仍按原逻辑 401（与吊销无关）', async () => {
  const token = await sign({ jti: 'j-exp', expSec: Math.floor(Date.now() / 1000) - 10 });
  assert.equal((await proxy(req('/api/auth/me', token))).status, 401);
});

test('登出接口永远放行：令牌已被吊销 / 已过期 / 根本没有 cookie 时，重复登出不会被挡成 401', async () => {
  const token = await sign({ jti: 'j-logout' });
  globalThis.__stubRevokedJtis.add('j-logout');
  const revoked = await proxy(req('/api/auth/logout', token));
  assert.equal(revoked.headers.get('x-middleware-next'), '1');
  const expired = await proxy(req('/api/auth/logout', await sign({ jti: 'j-x', expSec: Math.floor(Date.now() / 1000) - 10 })));
  assert.equal(expired.headers.get('x-middleware-next'), '1');
  const none = await proxy(req('/api/auth/logout'));
  assert.equal(none.headers.get('x-middleware-next'), '1');
  // 只放行登出这一个路径，/api/auth/me 仍然受保护
  assert.equal((await proxy(req('/api/auth/me', token))).status, 401);
});
