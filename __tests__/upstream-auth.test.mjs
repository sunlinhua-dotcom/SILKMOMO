// 上游鉴权口径单测（不联网）：Gemini 原生协议的密钥必须在请求头 x-goog-api-key，URL 里不许有 key；
// 上游地址可由环境变量覆盖、默认值与线上一致；上游错误回传不含密钥。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const KEY = 'unit-test-secret-key-AAAA1111';
const DEFAULT_LITE_URL = 'https://api.apiyi.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent';

function lockEnv(patch) {
  const prev = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
}

function okJson(text) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

function assertKeyInHeaderOnly(call, label) {
  assert.ok(call, `${label}: 没有发出请求`);
  const url = String(call.url);
  assert.doesNotMatch(url, /[?&]key=/i, `${label}: URL 里不许出现 key 参数`);
  assert.ok(!url.includes(KEY), `${label}: URL 里不许出现密钥原文`);
  const h = new Headers(call.init.headers);
  assert.equal(h.get('x-goog-api-key'), KEY, `${label}: 密钥必须在 x-goog-api-key 请求头`);
  assert.equal(h.get('authorization'), null, `${label}: Gemini 协议不带 Authorization`);
}

async function withAssistant(env, run) {
  const restoreEnv = lockEnv({ GEMINI_API_KEY: KEY, AI_ASSISTANT_BASE_URL: undefined, ...env });
  const prevFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return okJson(JSON.stringify({
      description: 'silk dress', keywords: ['silk'], category: 'dress', mixed: false, mixedReason: '',
      score: 9, issues: [], suggestion: '',
      primaryCategories: ['dress'], accessories: [], garmentsWornByPerson: false,
      skinTone: 'medium', faceBox2d: [0, 0, 1000, 1000], visibleFaceBox2d: [0, 0, 1000, 1000],
      headPose: 'frontal', occluders: [], occluderBoxes2d: [], visibility: 'full', confidence: 0.9,
    }));
  };
  try {
    const assistant = await import(`../lib/ai-assistant.ts?upstream-auth=${Date.now()}-${Math.random()}`);
    await run(assistant, calls);
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
}

test('ai-assistant 三个上游调用：密钥在请求头、URL 无 key，默认地址与线上一致', async () => {
  await withAssistant({}, async (assistant, calls) => {
    await assistant.analyzeProductImage('ZmFrZQ==', 'image/png');
    await assistant.analyzeLookbookGroup([{ data: 'ZmFrZQ==', mimeType: 'image/png' }]);
    await assistant.analyzeFaceRegionAndSkin('ZmFrZQ==', 'image/png');
    assert.equal(calls.length, 3);
    calls.forEach((c, i) => {
      assertKeyInHeaderOnly(c, `ai-assistant#${i + 1}`);
      assert.equal(String(c.url), DEFAULT_LITE_URL, `ai-assistant#${i + 1}: 不设新变量时地址必须与线上一致`);
    });
  });
});

test('AI_ASSISTANT_BASE_URL 可覆盖上游地址（尾部斜杠被吃掉）', async () => {
  await withAssistant({ AI_ASSISTANT_BASE_URL: 'http://127.0.0.1:9/v1beta/' }, async (assistant, calls) => {
    await assistant.analyzeProductImage('ZmFrZQ==', 'image/png');
    assert.equal(calls.length, 1);
    assert.equal(
      String(calls[0].url),
      'http://127.0.0.1:9/v1beta/models/gemini-3.1-flash-lite-preview:generateContent',
    );
    assertKeyInHeaderOnly(calls[0], 'override');
  });
});

test('ai-assistant 网络异常日志不含密钥（含带 ?key= 的 URL 形态）', async () => {
  const restoreEnv = lockEnv({ GEMINI_API_KEY: KEY, AI_ASSISTANT_BASE_URL: undefined });
  const prevFetch = globalThis.fetch;
  const prevWarn = console.warn;
  const logged = [];
  console.warn = (...args) => { logged.push(args.map(String).join(' ')); };
  globalThis.fetch = async () => {
    throw new TypeError(`fetch failed: https://x.example/v1beta/models/m:generateContent?key=${KEY}&alt=sse`);
  };
  try {
    const assistant = await import(`../lib/ai-assistant.ts?upstream-auth-err=${Date.now()}`);
    const r = await assistant.analyzeProductImage('ZmFrZQ==', 'image/png');
    assert.equal(r.ok, false);
    assert.ok(logged.length > 0);
    assert.ok(logged.every(line => !line.includes(KEY)), '日志里不许有密钥');
    assert.ok(logged.some(line => line.includes('key=***')), '日志里的 key 参数应被抹掉');
  } finally {
    console.warn = prevWarn;
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

async function loadBackends(env) {
  const restoreEnv = lockEnv({
    GEMINI_API_KEY: KEY, GEMINI_BASE_URL: 'http://127.0.0.1:9', OPENAI_IMAGE_API_KEY: undefined,
    OPENAI_IMAGE_BASE_URL: undefined, IMAGE_BACKEND: undefined, ...env,
  });
  let source = fs.readFileSync('lib/image-backends.ts', 'utf8');
  source = source.replace(
    /import \{ normalizeGenerationQuality, type GenerationQuality \} from '\.\/billing-constants';/,
    "const normalizeGenerationQuality = value => value || 'medium'; type GenerationQuality = 'low' | 'medium' | 'high';",
  );
  source = source.replace(
    /import \{ normalizeReferenceImage \} from '\.\/reference-image-normalizer';/,
    'const normalizeReferenceImage = async input => input;',
  );
  // 模块级常量在 import 时读环境变量，且 data: URL 会被缓存——加 nonce 保证每次都是全新实例。
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText + `\n// nonce ${Date.now()}-${Math.random()}\n`;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  return { mod, restoreEnv };
}

test('Gemini 出图通道：密钥在请求头、URL 无 key', async () => {
  const { mod, restoreEnv } = await loadBackends({});
  const prevFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await mod.generateImage({ prompt: 'p', productImages: [], aspectRatio: '1:1' }, 'gemini');
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assertKeyInHeaderOnly(calls[0], 'gemini-image');
    assert.equal(
      String(calls[0].url),
      'http://127.0.0.1:9/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    );
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test('Gemini 出图通道：上游 503 回显密钥/URL 时，返回给调用方的错误文案已脱敏', async () => {
  const { mod, restoreEnv } = await loadBackends({});
  const prevFetch = globalThis.fetch;
  const prevLog = console.log;
  const logged = [];
  console.log = (...args) => { logged.push(args.map(String).join(' ')); };
  globalThis.fetch = async () => new Response(
    `upstream echo https://x/v1beta/m:generateContent?key=${KEY} token=${KEY}`,
    { status: 400 },
  );
  try {
    const result = await mod.generateImage({ prompt: 'p', productImages: [], aspectRatio: '1:1' }, 'gemini');
    assert.equal(result.success, false);
    assert.ok(!String(result.error).includes(KEY), '返回错误里不许有密钥');
    assert.ok(!String(result.detail ?? '').includes(KEY), 'detail 里不许有密钥');
    assert.ok(!/key=/i.test(`${result.error} ${result.detail ?? ''}`.replace(/key=\*\*\*/gi, '')), '不许残留 key= 参数');
    assert.ok(logged.every(line => !line.includes(KEY)), '日志里不许有密钥');
  } finally {
    console.log = prevLog;
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test('OpenAI 兼容出图通道：密钥走 Authorization: Bearer，URL 无 key', async () => {
  const { mod, restoreEnv } = await loadBackends({
    OPENAI_IMAGE_API_KEY: 'openai-unit-key-BBBB2222', OPENAI_IMAGE_BASE_URL: 'http://127.0.0.1:9',
  });
  const prevFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await mod.generateImage({ prompt: 'p', productImages: [], aspectRatio: '1:1' }, 'openai');
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    const url = String(calls[0].url);
    assert.equal(url, 'http://127.0.0.1:9/v1/images/generations');
    assert.doesNotMatch(url, /key=/i);
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer openai-unit-key-BBBB2222');
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test('源码守卫：lib/ 与 app/ 下不许再把密钥拼进 URL；chat 回退通道用请求头', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  const offenders = [...walk('lib'), ...walk('app')].filter(file => {
    const text = fs.readFileSync(file, 'utf8');
    // 允许脱敏正则里出现 key= 字样；只抓「模板串里把 key 拼进 URL」
    return /generateContent\?key=|[?&]key=\$\{/.test(text);
  });
  assert.deepEqual(offenders, []);

  const chat = fs.readFileSync('app/api/ai/chat/route.ts', 'utf8');
  assert.match(chat, /'x-goog-api-key': API_CONFIG\.apiKey/);
  assert.match(chat, /AI_ASSISTANT_BASE_URL/);
});
