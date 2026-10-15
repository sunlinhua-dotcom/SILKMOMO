import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// 两个假 key：脱敏断言要在响应 / 异常 / 日志里找它们
const FAKE_GEMINI_KEY = 'sk-test-gemini-key-123456';
const FAKE_OPENAI_KEY = 'sk-test-openai-key-abcdef';
process.env.GEMINI_API_KEY = FAKE_GEMINI_KEY;
process.env.OPENAI_IMAGE_API_KEY = FAKE_OPENAI_KEY;
delete process.env.IMAGE_BACKEND;

// normalizeReferenceImage 在测试里由 globalThis.__normalizeStub 接管（可替换成带延迟 / 计数的版本）
globalThis.__normalizeStub = async input => input;

function transpile(src) {
  return ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
}
const importModule = code => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

let source = fs.readFileSync('lib/image-backends.ts', 'utf8');
source = source.replace(
  /import \{ normalizeGenerationQuality, type GenerationQuality \} from '\.\/billing-constants';/,
  "const normalizeGenerationQuality = value => value || 'medium'; type GenerationQuality = 'low' | 'medium' | 'high';",
);
source = source.replace(
  /import \{ normalizeReferenceImage \} from '\.\/reference-image-normalizer';/,
  'const normalizeReferenceImage = (...args) => globalThis.__normalizeStub(...args);',
);
// kie 客户端是独立模块（lib/kie-image.ts，无项目内 import）：data: URL 里不能写相对 import，转成动态 import
const kieModuleUrl = `data:text/javascript;base64,${Buffer.from(transpile(fs.readFileSync('lib/kie-image.ts', 'utf8'))).toString('base64')}`;
const inlineKieImport = code => code.replace(/import \{([^}]*)\} from '\.\/kie-image';/, (_m, names) => `const {${names}} = await import(${JSON.stringify(kieModuleUrl)});`);
source = inlineKieImport(source);
const backends = await importModule(transpile(source));

const b64 = text => Buffer.from(text).toString('base64');
const unb64 = data => Buffer.from(data, 'base64').toString();

/** 临时接管 fetch / console.log，返回调用记录。 */
async function withMockedNetwork(fetchImpl, body) {
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const calls = [];
  const logs = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return fetchImpl(String(url), init, calls.length);
  };
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    await body({ calls, logs });
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

const okImage = () => new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 });

test('buildGeminiParts omits the product label when no product image exists', () => {
  assert.equal(typeof backends.buildGeminiParts, 'function');
  const parts = backends.buildGeminiParts({
    prompt: 'portrait',
    productImages: [],
    aspectRatio: '3:4',
  });
  const text = parts.flatMap(part => typeof part.text === 'string' ? [part.text] : []).join('\n');
  assert.doesNotMatch(text, /Product Reference Images/);
});

test('openai backend falls back to /v1/images/generations when there is no reference image', () => {
  const source = fs.readFileSync('lib/image-backends.ts', 'utf8');

  // edits 端点必须带至少一张输入图；纯文生图（脸库候选脸）走它会被上游判参数错误
  // ——0802 线上实测 403 err_code:-10003。
  assert.match(source, /async function generateWithOpenAIText/);
  assert.match(source, /\/v1\/images\/generations/);
  assert.match(source, /if \(limited\.length === 0\) \{\s*\n\s*return generateWithOpenAIText\(input, retryCount\);/);

  // 与 edits 分支同口径：超时不重试，只有瞬时网络错误/503/429 才重试
  const textBranch = source.slice(source.indexOf('async function generateWithOpenAIText'));
  assert.match(textBranch, /!isTimeout && retryCount < MAX_RETRIES/);
  assert.match(textBranch, /response\.status === 503 \|\| response\.status === 429/);
});

// ───────────────────────── 参考图并发归一化 ─────────────────────────

test('reference normalization runs concurrently (<=3) and keeps output order', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const started = [];
  // 越靠前的图越慢：串行实现与「按完成顺序拼装」的实现都会在顺序断言上露馅
  const delays = { p0: 40, p1: 30, p2: 20, p3: 10, m0: 5, s0: 5, a0: 5, anchor: 5 };
  globalThis.__normalizeStub = async (img) => {
    const key = unb64(img.data);
    started.push(key);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, delays[key] ?? 1));
    inFlight -= 1;
    return { ...img, data: b64(`N:${key}`) };
  };

  await withMockedNetwork(async () => okImage(), async ({ calls }) => {
    const img = name => ({ data: b64(name), mimeType: 'image/png' });
    const result = await backends.generateImage({
      prompt: 'x',
      aspectRatio: '3:4',
      productImages: [img('p0'), img('p1'), img('p2'), img('p3')],
      modelRefImages: [img('m0')],
      sceneRefImages: [img('s0')],
      accessoryImages: [img('a0')],
      anchorImage: img('anchor'),
    }, 'openai');
    assert.equal(result.success, true);

    // edits 的 image[] 顺序：product -> model -> bg -> scene -> accessory -> anchor
    const form = calls[0].init.body;
    const sent = await Promise.all(form.getAll('image[]').map(file => file.text()));
    assert.deepEqual(sent, ['N:p0', 'N:p1', 'N:p2', 'N:p3', 'N:m0', 'N:s0', 'N:a0', 'N:anchor']);
  });

  assert.ok(maxInFlight > 1, `应当并发，实测最大并发 ${maxInFlight}`);
  assert.ok(maxInFlight <= 3, `并发不得超过 3，实测 ${maxInFlight}`);
  assert.deepEqual(started.slice(0, 3), ['p0', 'p1', 'p2']);
  globalThis.__normalizeStub = async input => input;
});

test('skipNormalization images bypass normalization but the anchor is always normalized', async () => {
  const seen = [];
  globalThis.__normalizeStub = async (img, label) => {
    seen.push(label);
    return { ...img, data: b64(`N:${unb64(img.data)}`) };
  };
  await withMockedNetwork(async () => okImage(), async ({ calls }) => {
    const img = (name, extra = {}) => ({ data: b64(name), mimeType: 'image/png', ...extra });
    await backends.generateImage({
      prompt: 'x',
      aspectRatio: '1:1',
      productImages: [img('p0'), img('p1', { skipNormalization: true })],
      anchorImage: img('anchor', { skipNormalization: true }),
    }, 'openai');
    const sent = await Promise.all(calls[0].init.body.getAll('image[]').map(f => f.text()));
    assert.deepEqual(sent, ['N:p0', 'p1', 'N:anchor']);
  });
  assert.deepEqual(seen.sort(), ['anchor', 'product[0]']);
  globalThis.__normalizeStub = async input => input;
});

// ───────────────────────── LRU：用 mock 的 sharp 测真实的 normalizer ─────────────────────────

async function loadNormalizer() {
  let src = fs.readFileSync('lib/reference-image-normalizer.ts', 'utf8');
  assert.match(src, /import sharp from 'sharp';/);
  src = src.replace(/import sharp from 'sharp';/, 'const sharp = (...args) => globalThis.__mockSharp(...args);');
  return importModule(transpile(src));
}

function installMockSharp() {
  const stats = { metadata: 0 };
  globalThis.__mockSharp = buf => {
    const text = buf.toString();
    const chain = {
      metadata: async () => {
        stats.metadata += 1;
        await new Promise(r => setTimeout(r, 5));
        if (text.startsWith('BAD')) throw new Error('corrupt image');
        return { width: 100, height: 100, hasAlpha: false };
      },
      stats: async () => ({ isOpaque: true }),
      rotate: () => chain,
      resize: () => chain,
      jpeg: () => chain,
      png: () => chain,
      toBuffer: async () => ({
        data: text.startsWith('BIG') ? Buffer.alloc(30 * 1024 * 1024, 97) : Buffer.from(`OUT:${text}`),
        info: { width: 100, height: 100 },
      }),
    };
    return chain;
  };
  return stats;
}

test('normalizer LRU: identical data is normalized once and hits keep caller fields', async () => {
  const stats = installMockSharp();
  const norm = await loadNormalizer();
  norm.__resetReferenceImageCacheForTest();
  const input = { data: b64('scene-1'), mimeType: 'image/png', skipNormalization: false, tag: 'keep-me' };

  const first = await norm.normalizeReferenceImage(input, 'a');
  const second = await norm.normalizeReferenceImage({ ...input, tag: 'other' }, 'b');
  assert.equal(stats.metadata, 1, '第二次应命中缓存，不再跑 sharp');
  assert.equal(unb64(first.data), 'OUT:scene-1');
  assert.equal(first.mimeType, 'image/jpeg');
  assert.equal(second.data, first.data);
  assert.equal(second.tag, 'other', '命中时调用方传入的其它字段必须保留');

  await norm.normalizeReferenceImage({ data: b64('scene-2'), mimeType: 'image/png' }, 'c');
  assert.equal(stats.metadata, 2);
});

test('normalizer LRU: concurrent identical inputs share one in-flight normalization', async () => {
  const stats = installMockSharp();
  const norm = await loadNormalizer();
  norm.__resetReferenceImageCacheForTest();
  const input = { data: b64('dup'), mimeType: 'image/png' };
  const [a, b, c] = await Promise.all([
    norm.normalizeReferenceImage(input, 'a'),
    norm.normalizeReferenceImage(input, 'b'),
    norm.normalizeReferenceImage(input, 'c'),
  ]);
  assert.equal(stats.metadata, 1);
  assert.equal(a.data, b.data);
  assert.equal(b.data, c.data);
});

test('normalizer LRU: failures fall back to the original and are never cached', async () => {
  const stats = installMockSharp();
  const norm = await loadNormalizer();
  norm.__resetReferenceImageCacheForTest();
  const bad = { data: b64('BAD-image'), mimeType: 'image/png' };
  const r1 = await norm.normalizeReferenceImage(bad, 'bad');
  const r2 = await norm.normalizeReferenceImage(bad, 'bad');
  assert.equal(r1, bad, '失败必须原样返回同一个对象');
  assert.equal(r2, bad);
  assert.equal(stats.metadata, 2, '失败结果不进缓存，每次都重试');
  assert.equal(norm.__referenceImageCacheStatsForTest().entries, 0);
});

test('normalizer LRU: evicts least-recently-used beyond 16 entries', async () => {
  const stats = installMockSharp();
  const norm = await loadNormalizer();
  norm.__resetReferenceImageCacheForTest();
  const mk = i => ({ data: b64(`img-${i}`), mimeType: 'image/png' });
  for (let i = 0; i < 16; i += 1) await norm.normalizeReferenceImage(mk(i), `i${i}`);
  assert.equal(stats.metadata, 16);
  assert.equal(norm.__referenceImageCacheStatsForTest().entries, 16);

  await norm.normalizeReferenceImage(mk(0), 'touch-0'); // 命中，刷新 0 为最近使用
  assert.equal(stats.metadata, 16);
  await norm.normalizeReferenceImage(mk(16), 'new-16'); // 第 17 项，淘汰最久未用的 1
  assert.equal(stats.metadata, 17);
  assert.equal(norm.__referenceImageCacheStatsForTest().entries, 16);

  await norm.normalizeReferenceImage(mk(0), 'again-0');
  assert.equal(stats.metadata, 17, '0 被刷新过，不应被淘汰');
  await norm.normalizeReferenceImage(mk(1), 'again-1');
  assert.equal(stats.metadata, 18, '1 是最久未用，应被淘汰后重新归一化');
});

test('normalizer LRU: total bytes are capped around 64MB', async () => {
  installMockSharp();
  const norm = await loadNormalizer();
  norm.__resetReferenceImageCacheForTest();
  // 无损路径（preserveLossless）不受 800KB 限制：每项归一化结果约 40MB 的 base64，
  // 两项就超过 64MB 上限，最旧的必须被挤出
  const lossless = { preserveLossless: true };
  await norm.normalizeReferenceImage({ data: b64('BIG-1'), mimeType: 'image/png' }, 'big1', lossless);
  await norm.normalizeReferenceImage({ data: b64('BIG-2'), mimeType: 'image/png' }, 'big2', lossless);
  const stats = norm.__referenceImageCacheStatsForTest();
  assert.equal(stats.entries, 1);
  assert.ok(stats.bytes <= 64 * 1024 * 1024, `缓存字节 ${stats.bytes} 超过上限`);
});

// ───────────────────────── 错误脱敏 ─────────────────────────

const PLANTED = `UPSTREAM-RAW-DETAIL ${FAKE_OPENAI_KEY} https://api.example/v1?key=${FAKE_GEMINI_KEY}`;

function assertClean(text, label) {
  assert.ok(text, `${label} 不应为空`);
  assert.doesNotMatch(text, /UPSTREAM-RAW-DETAIL/, `${label} 不应含上游原文`);
  assert.ok(!text.includes(FAKE_OPENAI_KEY), `${label} 不应含 OpenAI key`);
  assert.ok(!text.includes(FAKE_GEMINI_KEY), `${label} 不应含 Gemini key`);
  assert.doesNotMatch(text, /https?:\/\//, `${label} 不应含 URL`);
}

test('openai HTTP failure: client message is generic, raw text only reaches sanitized log/detail', async () => {
  const input = { prompt: 'x', aspectRatio: '1:1', productImages: [{ data: b64('p'), mimeType: 'image/png' }], allowRetryOn5xx: false };
  await withMockedNetwork(async () => new Response(PLANTED, { status: 503 }), async ({ logs }) => {
    const result = await backends.generateImage(input, 'openai');
    assert.equal(result.success, false);
    assert.match(result.error, /上游 503/);
    assert.equal(result.errorKind, 'upstream_unavailable');
    assert.equal(result.httpStatus, 503);
    assertClean(result.error, 'error');
    // 原文进 detail / 日志，但 key 必须已被打码
    assert.match(result.detail, /UPSTREAM-RAW-DETAIL/);
    assert.ok(!result.detail.includes(FAKE_OPENAI_KEY) && !result.detail.includes(FAKE_GEMINI_KEY));
    const logText = logs.join('\n');
    assert.match(logText, /UPSTREAM-RAW-DETAIL/);
    assert.ok(!logText.includes(FAKE_OPENAI_KEY) && !logText.includes(FAKE_GEMINI_KEY), '日志里的 key 必须打码');
    assert.match(logText, /key=\*\*\*/);
  });
});

test('openai text-to-image HTTP failure is sanitized too, 429 keeps its own category', async () => {
  await withMockedNetwork(async () => new Response(PLANTED, { status: 400 }), async () => {
    const result = await backends.generateImage({ prompt: 'x', aspectRatio: '1:1', productImages: [] }, 'openai');
    assertClean(result.error, 'error');
    assert.match(result.error, /上游 400/);
    assert.equal(result.errorKind, 'upstream_rejected');
  });
  assert.equal(backends.sanitizeError('GET /x?key=abc123&y=1 Bearer abcdefghij12345'), 'GET /x?key=***&y=1 Bearer ***');
});

test('sanitizeError masks common token shapes (sk-/pk-/AIza/ghp_) even when not in env', async () => {
  const tokens = ['sk-proj-AbCd1234_efGh-5678', 'sk-abcdefgh', 'pk-live_ABCDEFGH1234', 'AIzaSyA1234567890abcdefghijKLMNOP', 'ghp_' + 'a'.repeat(36)];
  for (const t of tokens) {
    const out = backends.sanitizeError(`upstream said: invalid key ${t} (status 401)`);
    assert.ok(!out.includes(t), `token leaked: ${t} -> ${out}`);
    assert.match(out, /invalid key \*\*\* \(status 401\)/);
  }
  // 普通文本不误伤：太短的 sk- 片段、含 sk- 的单词
  assert.equal(backends.sanitizeError('task-queue risk-free sk-1'), 'task-queue risk-free sk-1');
});

test('ai-assistant sanitizeUpstreamError uses the same token masking', async () => {
  const assistant = await import(`../lib/ai-assistant.ts?sanitize-test=${Date.now()}`);
  const t = 'sk-proj-AbCd1234_efGh-5678';
  const out = assistant.sanitizeUpstreamError(new Error(`fail ${t} Bearer abcdefghij12345 /x?key=zzz999`));
  assert.ok(!out.includes(t));
  assert.equal(out, 'fail *** Bearer *** /x?key=***');
  assert.equal(assistant.sanitizeUpstreamError('AIzaSyA1234567890abcdefghijKLMNOP'), '***');
});

test('gemini HTTP failure, moderation text and key echo are sanitized', async () => {
  const input = { prompt: 'x', aspectRatio: '1:1', productImages: [{ data: b64('p'), mimeType: 'image/png' }] };
  await withMockedNetwork(async () => new Response(PLANTED, { status: 502 }), async ({ logs }) => {
    const result = await backends.generateImage(input, 'gemini');
    assertClean(result.error, 'error');
    assert.match(result.error, /上游 502/);
    assert.ok(!logs.join('\n').includes(FAKE_GEMINI_KEY));
  });
  await withMockedNetwork(async () => new Response('{"error":"blocked by content_policy"}', { status: 400 }), async () => {
    const result = await backends.generateImage(input, 'gemini');
    assert.equal(result.errorKind, 'moderation');
    assert.doesNotMatch(result.error, /content_policy/);
  });
});

test('network errors never leak the request URL or key into the client message', async () => {
  const leaky = new Error(`fetch failed: https://api.apiyi.com/v1beta/models/m:generateContent?key=${FAKE_GEMINI_KEY}`);
  const input = { prompt: 'x', aspectRatio: '1:1', productImages: [{ data: b64('p'), mimeType: 'image/png' }] };
  for (const backend of ['gemini', 'openai']) {
    await withMockedNetwork(async () => { throw leaky; }, async ({ logs }) => {
      const result = await backends.generateImage(input, backend);
      assertClean(result.error, `${backend} error`);
      assert.match(result.error, /^网络连接失败/);
      assert.equal(result.errorKind, 'network');
      assert.ok(!(result.detail || '').includes(FAKE_GEMINI_KEY));
      assert.ok(!logs.join('\n').includes(FAKE_GEMINI_KEY));
    });
  }
});

test('timeouts keep the 超时 wording and the openai channel still does not retry them', async () => {
  const input = { prompt: 'x', aspectRatio: '1:1', productImages: [{ data: b64('p'), mimeType: 'image/png' }] };
  await withMockedNetwork(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }, async ({ calls }) => {
    const result = await backends.generateImage(input, 'openai');
    assert.equal(result.errorKind, 'timeout');
    assert.match(result.error, /（超时 360s）/);
    assert.equal(calls.length, 1, '超时不重试');
  });
});

test('unparseable 200 responses do not echo the body (or parse-error snippet)', async () => {
  const input = { prompt: 'x', aspectRatio: '1:1', productImages: [{ data: b64('p'), mimeType: 'image/png' }] };
  for (const backend of ['gemini', 'openai']) {
    await withMockedNetwork(async () => new Response(`<html>${PLANTED}</html>`, { status: 200 }), async () => {
      const result = await backends.generateImage(input, backend);
      assert.equal(result.success, false);
      assert.equal(result.errorKind, 'bad_response');
      assertClean(result.error, `${backend} error`);
      assert.ok(!(result.detail || '').includes(FAKE_OPENAI_KEY));
    });
  }
});

// ───────────────────────── Blob 复用 ─────────────────────────

test('openai edits retry reuses the same decoded image Blobs instead of re-copying base64', async () => {
  const input = {
    prompt: 'x', aspectRatio: '1:1',
    productImages: [{ data: b64('big-product'), mimeType: 'image/png' }],
    maskImage: { data: b64('mask'), mimeType: 'image/png' },
  };
  await withMockedNetwork(async (_url, _init, n) => {
    if (n === 1) throw new Error('ECONNRESET');
    return okImage();
  }, async ({ calls }) => {
    const result = await backends.generateImage(input, 'openai');
    assert.equal(result.success, true);
    assert.equal(calls.length, 2, '瞬时网络错误重试一次');
    const read = async call => ({
      images: await Promise.all(call.init.body.getAll('image[]').map(f => f.text())),
      mask: await call.init.body.get('mask').text(),
    });
    assert.deepEqual(await read(calls[0]), { images: ['big-product'], mask: 'mask' });
    assert.deepEqual(await read(calls[1]), { images: ['big-product'], mask: 'mask' });
  });

  const src = fs.readFileSync('lib/image-backends.ts', 'utf8');
  const start = src.indexOf('async function postOpenAIEdits');
  const retryLoop = src.slice(start, src.indexOf('const read = await readJsonBody', start));
  assert.ok(!/Buffer\.from\(/.test(retryLoop), '重试循环里不许再做 base64 解码拷贝');
  assert.ok(!/new Blob\(/.test(retryLoop), '重试循环里不许再构造 Blob');
});

// ───────────────────────── kie.ai 提供方（GPT 通道） ─────────────────────────

const kie = await import(kieModuleUrl);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const FAKE_KIE_KEY = 'kie-test-key-ZZZZ9999aaaa';

/** 临时设置环境变量，返回还原函数。 */
function lockEnv(patch) {
  const prev = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}

/** 全新实例的 image-backends 模块（模块级常量在 import 时读环境变量，所以每个场景一个实例）。 */
async function loadBackendsVariant() {
  let src = fs.readFileSync('lib/image-backends.ts', 'utf8');
  src = src.replace(
    /import \{ normalizeGenerationQuality, type GenerationQuality \} from '\.\/billing-constants';/,
    "const normalizeGenerationQuality = value => value || 'medium'; type GenerationQuality = 'low' | 'medium' | 'high';",
  );
  src = src.replace(/import \{ normalizeReferenceImage \} from '\.\/reference-image-normalizer';/, 'const normalizeReferenceImage = (...args) => globalThis.__normalizeStub(...args);');
  src = inlineKieImport(src);
  return importModule(transpile(src) + `\n// nonce ${Date.now()}-${Math.random()}\n`);
}

async function withKie(env, body) {
  const restore = lockEnv({ KIE_API_KEY: FAKE_KIE_KEY, OPENAI_IMAGE_PROVIDER: undefined, KIE_POLL_INTERVAL_MS: '20', KIE_BASE_URL: undefined, KIE_UPLOAD_URL: undefined, KIE_IMAGE_RESOLUTION: undefined, KIE_IMAGE_MODEL_I2I: undefined, KIE_IMAGE_MODEL_T2I: undefined, ...env });
  try {
    await body(await loadBackendsVariant());
  } finally {
    restore();
  }
}

/** 假 kie：上传 / 建任务 / 轮询 / 结果图下载，记录每次调用。 */
function fakeKie(opts = {}) {
  const rec = { uploads: [], creates: [], polls: 0, downloads: 0, headers: [] };
  const states = opts.states ?? ['waiting', 'generating', 'success'];
  const handler = async (url, init) => {
    const u = new URL(url);
    const headers = new Headers(init?.headers);
    rec.headers.push({ host: u.host, path: u.pathname, auth: headers.get('authorization'), ua: headers.get('user-agent') });
    if (u.pathname === '/api/file-base64-upload') {
      const b = JSON.parse(init.body);
      rec.uploads.push(b);
      return Response.json({ success: true, code: 200, data: { downloadUrl: `https://tempfile.example/${b.fileName}` } });
    }
    if (u.pathname === '/api/v1/jobs/createTask') {
      rec.creates.push(JSON.parse(init.body));
      if (opts.onCreate) { const r = opts.onCreate(rec.creates.length); if (r) return r; }
      return Response.json({ code: 200, msg: 'success', data: { taskId: 'task-1' } });
    }
    if (u.pathname === '/api/v1/jobs/recordInfo') {
      const state = states[Math.min(rec.polls, states.length - 1)];
      rec.polls++;
      const data = { taskId: 'task-1', state, costTime: 3 };
      if (state === 'success') data.resultJson = JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.example/r.png?X-Amz-Signature=SECRETSIG123&X-Amz-Expires=3600'] });
      if (state === 'fail') { data.failCode = opts.failCode ?? '500'; data.failMsg = opts.failMsg ?? 'generation failed'; }
      return Response.json({ code: 200, msg: 'success', data });
    }
    if (u.host === 'tempfile.aiquickdraw.example') { rec.downloads++; return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'application/octet-stream' } }); }
    throw new Error(`unexpected url ${url}`);
  };
  return { rec, handler };
}

const img = (text, mimeType = 'image/jpeg') => ({ data: b64(text), mimeType });
const i2iInput = (extra = {}) => ({ prompt: 'make it', aspectRatio: '3:4', productImages: [img('product-1')], ...extra });

test('provider 选择：无 KIE key = 302 原样；有 key = kie；显式 302 覆盖；显式 kie 不回落', () => {
  assert.equal(kie.resolveOpenAIProvider({}), '302');
  assert.equal(kie.resolveOpenAIProvider({ KIE_API_KEY: '  ' }), '302');
  assert.equal(kie.resolveOpenAIProvider({ KIE_API_KEY: 'k' }), 'kie');
  assert.equal(kie.resolveOpenAIProvider({ KIE_API_KEY: 'k', OPENAI_IMAGE_PROVIDER: '302' }), '302');
  assert.equal(kie.resolveOpenAIProvider({ KIE_API_KEY: 'k', OPENAI_IMAGE_PROVIDER: ' 302AI ' }), '302');
  assert.equal(kie.resolveOpenAIProvider({ OPENAI_IMAGE_PROVIDER: 'kie' }), 'kie');
  assert.equal(kie.resolveOpenAIProvider({ KIE_API_KEY: 'k', OPENAI_IMAGE_PROVIDER: 'whatever' }), 'kie');
  assert.equal(kie.resolveOpenAIProvider({ OPENAI_IMAGE_PROVIDER: 'whatever' }), '302');
});

test('provider：无 KIE key 时 generateImage 仍打 302 edits，kie 完全不碰', async () => {
  await withKie({ KIE_API_KEY: undefined }, async mod => {
    assert.equal(mod.getOpenAIProvider(), '302');
    await withMockedNetwork(async () => okImage(), async ({ calls }) => {
      const result = await mod.generateImage(i2iInput(), 'openai');
      assert.equal(result.success, true);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/v1\/images\/edits$/);
      assert.equal(result.model, 'gpt-image-2');
    });
  });
});

test('kie 配置默认值与环境变量覆盖', () => {
  const d = kie.readKieConfig({ KIE_API_KEY: 'k' });
  assert.deepEqual([d.baseUrl, d.uploadUrl, d.modelI2I, d.modelT2I, d.resolution, d.pollIntervalMs],
    ['https://api.kie.ai', 'https://kieai.redpandaai.co/api/file-base64-upload', 'gpt-image-2-5-flare-image-to-image', 'gpt-image-2-5-flare-text-to-image', '2K', 2500]);
  const o = kie.readKieConfig({ KIE_API_KEY: 'k', KIE_BASE_URL: 'http://127.0.0.1:1/', KIE_UPLOAD_URL: 'http://127.0.0.1:2/up', KIE_IMAGE_MODEL_I2I: 'm1', KIE_IMAGE_MODEL_T2I: 'm2', KIE_IMAGE_RESOLUTION: '4k' });
  assert.deepEqual([o.baseUrl, o.uploadUrl, o.modelI2I, o.modelT2I, o.resolution], ['http://127.0.0.1:1', 'http://127.0.0.1:2/up', 'm1', 'm2', '4K']);
  assert.equal(kie.readKieConfig({ KIE_BASE_URL: 'ftp://x' }).baseUrl, 'https://api.kie.ai');
  assert.equal(kie.readKieConfig({ KIE_IMAGE_RESOLUTION: '8K' }).resolution, '2K');
});

test('比例映射：项目五种预设原样命中；其它取最接近；2K 不选只有 1K 的画幅', () => {
  for (const r of ['1:1', '3:4', '4:3', '9:16', '16:9']) assert.equal(kie.mapAspectToKie(r, '2K'), r);
  assert.equal(kie.mapAspectToKie('5:4', '2K'), '4:3');
  assert.equal(kie.mapAspectToKie('4:5', '2K'), '3:4');
  assert.equal(kie.mapAspectToKie('2:1', '2K'), '16:9');
  assert.equal(kie.mapAspectToKie('3:1', '2K'), '21:9');
  assert.equal(kie.mapAspectToKie('9:8', '2K'), '1:1');
  assert.equal(kie.mapAspectToKie('9:8', '1K'), '9:8');
  assert.equal(kie.mapAspectToKie('auto', '2K'), 'auto');
  assert.equal(kie.mapAspectToKie('garbage', '2K'), 'auto');
  assert.equal(kie.mapAspectToKie(undefined, '2K'), 'auto');
});

test('resultJson 要二次 parse；对象 / 坏 JSON / 非 http 地址都稳', () => {
  assert.deepEqual(kie.parseKieResultUrls('{"resultUrls":["https://a/x.png"]}'), ['https://a/x.png']);
  assert.deepEqual(kie.parseKieResultUrls({ resultUrls: ['https://a/y.png'] }), ['https://a/y.png']);
  assert.deepEqual(kie.parseKieResultUrls('{not json'), []);
  assert.deepEqual(kie.parseKieResultUrls('{"resultUrls":["javascript:alert(1)","file:///etc/passwd"]}'), []);
  assert.deepEqual(kie.parseKieResultUrls(null), []);
});

test('kie 图生图：上传 → 建任务 → 轮询 → 下载字节，请求头 / 参数 / 顺序全对', async () => {
  await withKie({}, async mod => {
    assert.equal(mod.getOpenAIProvider(), 'kie');
    const fake = fakeKie();
    await withMockedNetwork(fake.handler, async ({ logs }) => {
      const result = await mod.generateImage({
        prompt: 'compose', aspectRatio: '16:9', sceneAsEditBase: true,
        sceneRefImages: [img('scene')], anchorImage: img('anchor', 'image/png'),
        productImages: [img('prod-a'), img('prod-b', 'image/png')], accessoryImages: [img('acc')],
      }, 'openai');
      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.backend, 'openai');
      assert.equal(result.model, 'gpt-image-2-5-flare-image-to-image');
      assert.deepEqual(Buffer.from(result.data, 'base64'), Buffer.from(PNG_BYTES));
      assert.equal(fake.rec.uploads.length, 5);
      assert.equal(fake.rec.creates.length, 1);
      const c = fake.rec.creates[0];
      assert.equal(c.model, 'gpt-image-2-5-flare-image-to-image');
      assert.equal(c.input.aspect_ratio, '16:9');
      assert.equal(c.input.resolution, '2K');
      assert.equal(c.input.input_urls.length, 5);
      // 顺序 = scene-base, anchor, product, product, accessory（与 302 edits 的 image[] 一致）
      const uploadedOrder = c.input.input_urls.map(u => fake.rec.uploads.find(x => u.endsWith(x.fileName)));
      assert.deepEqual(uploadedOrder.map(x => Buffer.from(x.base64Data.split(',')[1], 'base64').toString()), ['scene', 'anchor', 'prod-a', 'prod-b', 'acc']);
      assert.match(c.input.prompt, /^compose[\s\S]*Reference image roles[\s\S]*1\. scene-base/);
      assert.equal(fake.rec.polls, 3);
      // 鉴权：kie API 与上传带 Bearer + 浏览器 UA；结果 CDN 只带 UA、不带 key
      for (const h of fake.rec.headers) {
        assert.match(h.ua, /Mozilla\/5\.0/);
        if (h.host === 'tempfile.aiquickdraw.example') assert.equal(h.auth, null, '结果 CDN 不许收到 Authorization');
        else assert.equal(h.auth, `Bearer ${FAKE_KIE_KEY}`);
      }
      // 日志不含 key、不含签名 query
      const logText = logs.join('\n');
      assert.ok(!logText.includes(FAKE_KIE_KEY));
      assert.doesNotMatch(logText, /SECRETSIG123/);
      // 上传文件名随机且互不相同（防止多用户同名互相覆盖）
      const names = fake.rec.uploads.map(x => x.fileName);
      assert.equal(new Set(names).size, names.length);
      names.forEach(n => assert.match(n, /^[0-9a-f-]{36}\.(jpeg|png)$/));
    });
  });
});

test('kie 相同参考图只上传一次但 input_urls 位置保留', async () => {
  await withKie({}, async mod => {
    const fake = fakeKie();
    await withMockedNetwork(fake.handler, async () => {
      const dup = img('same-garment');
      const result = await mod.generateImage({ prompt: 'p', aspectRatio: '1:1', productImages: [dup, dup, img('other')] }, 'openai');
      assert.equal(result.success, true);
      assert.equal(fake.rec.uploads.length, 2);
      const urls = fake.rec.creates[0].input.input_urls;
      assert.equal(urls.length, 3);
      assert.equal(urls[0], urls[1]);
      assert.notEqual(urls[0], urls[2]);
    });
  });
});

test('kie 纯文生图（脸库候选脸）：不上传、走 t2i 模型、prompt 原样', async () => {
  await withKie({}, async mod => {
    const fake = fakeKie();
    await withMockedNetwork(fake.handler, async () => {
      const result = await mod.generateImage({ prompt: 'portrait only', aspectRatio: '3:4', productImages: [], quality: 'medium', timeoutMs: 330_000 }, 'openai');
      assert.equal(result.success, true);
      assert.equal(result.model, 'gpt-image-2-5-flare-text-to-image');
      assert.equal(fake.rec.uploads.length, 0);
      const c = fake.rec.creates[0];
      assert.equal(c.model, 'gpt-image-2-5-flare-text-to-image');
      assert.equal(c.input.prompt, 'portrait only');
      assert.equal('input_urls' in c.input, false);
      assert.equal(c.input.aspect_ratio, '3:4');
    });
    assert.equal(mod.resolveApiModel('openai'), 'gpt-image-2-5-flare-image-to-image');
    assert.equal(mod.resolveApiModel('openai', { textOnly: true }), 'gpt-image-2-5-flare-text-to-image');
    assert.equal(mod.resolveApiModel('gemini', { textOnly: true }), 'gemini-3.1-flash-image-preview');
  });
});

test('kie 环境变量覆盖模型 / 分辨率', async () => {
  await withKie({ KIE_IMAGE_MODEL_I2I: 'custom-i2i', KIE_IMAGE_RESOLUTION: '1K' }, async mod => {
    const fake = fakeKie();
    await withMockedNetwork(fake.handler, async () => {
      const result = await mod.generateImage(i2iInput({ aspectRatio: '1:1' }), 'openai');
      assert.equal(result.model, 'custom-i2i');
      assert.equal(fake.rec.creates[0].input.resolution, '1K');
    });
    assert.equal(mod.resolveApiModel('openai'), 'custom-i2i');
  });
});

test('kie 余额不足（code 402 / HTTP 402 / 余额字样）：专属分类 + 通用文案，不说鉴权失败，不泄原文', async () => {
  const cases = [
    () => Response.json({ code: 402, msg: 'Insufficient credits UPSTREAM-RAW-DETAIL', data: null }),
    () => new Response('{"code":402,"msg":"credits not enough UPSTREAM-RAW-DETAIL"}', { status: 402 }),
    () => Response.json({ code: 500, msg: 'account balance insufficient UPSTREAM-RAW-DETAIL' }),
  ];
  for (const make of cases) {
    await withKie({}, async mod => {
      const fake = fakeKie({ onCreate: make });
      const realErr = console.error; const errs = []; console.error = (...a) => { errs.push(a.join(' ')); };
      try {
        await withMockedNetwork(fake.handler, async () => {
          const result = await mod.generateImage(i2iInput(), 'openai');
          assert.equal(result.success, false);
          assert.equal(result.errorKind, 'upstream_quota');
          assert.equal(result.error, '出图服务暂时不可用，请稍后重试');
          assert.doesNotMatch(result.error, /鉴权|余额|credit|UPSTREAM/i);
          assert.match(result.detail, /UPSTREAM-RAW-DETAIL/);
          assert.equal(fake.rec.creates.length, 1, '余额不足不重试');
        });
      } finally { console.error = realErr; }
      assert.ok(errs.some(l => /\[upstream-quota\]/.test(l)), '服务端日志要有充值告警');
    });
  }
});

test('302 余额不足（HTTP 401 + err_code -10004）也识别为 upstream_quota，不再报成「拒绝了请求」', async () => {
  await withKie({ KIE_API_KEY: undefined }, async mod => {
    const realErr = console.error; console.error = () => {};
    try {
      const body = '{"error":{"err_code":-10004,"message":"Insufficient account balance","message_cn":"账户余额不足"}}';
      for (const input of [i2iInput(), { prompt: 'x', aspectRatio: '1:1', productImages: [] }]) {
        await withMockedNetwork(async () => new Response(body, { status: 401 }), async () => {
          const result = await mod.generateImage(input, 'openai');
          assert.equal(result.errorKind, 'upstream_quota');
          assert.equal(result.httpStatus, 401);
          assert.equal(result.error, '出图服务暂时不可用，请稍后重试');
        });
      }
    } finally { console.error = realErr; }
  });
});

test('余额不足识别不误伤：普通 401 / 内容审核 / 429 / 503 仍走原分类', async () => {
  await withKie({ KIE_API_KEY: undefined }, async mod => {
    for (const [status, text, kind] of [[401, 'invalid api key', 'upstream_rejected'], [400, 'blocked by content_policy', 'moderation'], [429, 'slow down', 'rate_limit'], [503, 'overloaded', 'upstream_unavailable']]) {
      await withMockedNetwork(async () => new Response(text, { status }), async () => {
        const result = await mod.generateImage({ ...i2iInput(), allowRetryOn5xx: false }, 'openai');
        assert.equal(result.errorKind, kind, `${status} ${text}`);
      });
    }
  });
});

test('kie 任务失败（state=fail）：不重试、通用文案；审核类 failMsg 归 moderation；回显 key 会被打码', async () => {
  await withKie({}, async mod => {
    const fake = fakeKie({ states: ['generating', 'fail'], failMsg: `internal error ${FAKE_KIE_KEY}` });
    await withMockedNetwork(fake.handler, async ({ logs }) => {
      const result = await mod.generateImage(i2iInput(), 'openai');
      assert.equal(result.success, false);
      assert.equal(result.errorKind, 'upstream_rejected');
      assert.equal(result.error, '出图服务生成失败，请稍后重试');
      assert.ok(!result.detail.includes(FAKE_KIE_KEY));
      assert.ok(!logs.join('\n').includes(FAKE_KIE_KEY));
      assert.equal(fake.rec.creates.length, 1);
    });
    const fake2 = fakeKie({ states: ['fail'], failMsg: 'Content policy violation: sensitive' });
    await withMockedNetwork(fake2.handler, async () => {
      assert.equal((await mod.generateImage(i2iInput(), 'openai')).errorKind, 'moderation');
    });
    const fake3 = fakeKie({ states: ['fail'], failMsg: 'Insufficient credits' });
    const realErr = console.error; console.error = () => {};
    try {
      await withMockedNetwork(fake3.handler, async () => {
        assert.equal((await mod.generateImage(i2iInput(), 'openai')).errorKind, 'upstream_quota');
      });
    } finally { console.error = realErr; }
  });
});

test('kie 轮询超时：总预算到点即停，错误是超时分类 + 超时措辞，且只建过一次任务', async () => {
  await withKie({}, async mod => {
    const fake = fakeKie({ states: ['generating'] });
    await withMockedNetwork(fake.handler, async () => {
      const t0 = Date.now();
      const result = await mod.generateImage({ ...i2iInput(), timeoutMs: 400 }, 'openai');
      assert.equal(result.success, false);
      assert.equal(result.errorKind, 'timeout');
      assert.match(result.error, /^网络连接失败（超时 \d+s）/);
      assert.ok(Date.now() - t0 < 2500, '到点要立刻停，不能再多轮询');
      assert.equal(fake.rec.creates.length, 1);
      assert.ok(fake.rec.polls >= 2);
    });
  });
});

test('kie 取消：AbortSignal 触发后立即停止轮询、不再多发请求', async () => {
  await withKie({}, async mod => {
    const fake = fakeKie({ states: ['generating'] });
    const ac = new AbortController();
    await withMockedNetwork(fake.handler, async () => {
      setTimeout(() => ac.abort(), 150);
      const result = await mod.generateImage({ ...i2iInput(), signal: ac.signal }, 'openai');
      assert.equal(result.success, false);
      assert.equal(result.error, '出图请求已取消');
      const pollsAtAbort = fake.rec.polls;
      await new Promise(r => setTimeout(r, 200));
      assert.equal(fake.rec.polls, pollsAtAbort, '取消后不许再轮询');
    });
    // 一开始就已取消：连上传都不发
    const fake2 = fakeKie();
    await withMockedNetwork(fake2.handler, async ({ calls }) => {
      const result = await mod.generateImage({ ...i2iInput(), signal: AbortSignal.abort() }, 'openai');
      assert.equal(result.success, false);
      assert.equal(calls.length, 0);
    });
  });
});

test('kie 建任务是非幂等 POST：发出后失败不重投；连接阶段失败才重试一次', async () => {
  await withKie({}, async mod => {
    // 发出后网络错误：只建一次
    let creates = 0;
    await withMockedNetwork(async url => {
      if (url.includes('createTask')) { creates++; throw new Error('socket hang up'); }
      return Response.json({ success: true, code: 200, data: { downloadUrl: 'https://t.example/a.jpeg' } });
    }, async () => {
      const result = await mod.generateImage(i2iInput(), 'openai');
      assert.equal(result.errorKind, 'network');
      assert.equal(creates, 1);
    });
    // 5xx：同样不重投
    const f5 = fakeKie({ onCreate: () => new Response('bad gateway', { status: 502 }) });
    await withMockedNetwork(f5.handler, async () => {
      const result = await mod.generateImage(i2iInput(), 'openai');
      assert.equal(result.errorKind, 'upstream_unavailable');
      assert.equal(f5.rec.creates.length, 1);
    });
    // 连接阶段（DNS）失败：重试一次后成功
    const f6 = fakeKie();
    let tries = 0;
    await withMockedNetwork(async (url, init) => {
      if (url.includes('createTask') && ++tries === 1) { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }
      return f6.handler(url, init);
    }, async () => {
      assert.equal((await mod.generateImage(i2iInput(), 'openai')).success, true);
      assert.equal(tries, 2);
    });
  });
});

test('kie 建任务 429（被限流拒收）等 3 秒重试一次', async () => {
  await withKie({}, async mod => {
    const fake = fakeKie({ onCreate: n => (n === 1 ? Response.json({ code: 429, msg: 'rate limited' }) : null) });
    await withMockedNetwork(fake.handler, async () => {
      const result = await mod.generateImage(i2iInput(), 'openai');
      assert.equal(result.success, true);
      assert.equal(fake.rec.creates.length, 2);
    });
  });
});

test('kie 轮询偶发错误不放弃已建好的任务；连续失败超限才报错', async () => {
  await withKie({}, async mod => {
    const fake = fakeKie();
    let blips = 0;
    await withMockedNetwork(async (url, init) => {
      if (url.includes('recordInfo') && blips < 2) { blips++; throw new Error('ECONNRESET'); }
      return fake.handler(url, init);
    }, async () => {
      assert.equal((await mod.generateImage(i2iInput(), 'openai')).success, true);
    });
    const fake2 = fakeKie();
    await withMockedNetwork(async (url, init) => {
      if (url.includes('recordInfo')) throw new Error('ECONNRESET');
      return fake2.handler(url, init);
    }, async () => {
      const result = await mod.generateImage({ ...i2iInput(), timeoutMs: 8000 }, 'openai');
      assert.equal(result.success, false);
      assert.equal(result.errorKind, 'network');
    });
  });
});

test('kie 结果下载校验：非图片内容 / 空内容 / HTTP 错误都是 download 失败', async () => {
  await withKie({}, async mod => {
    for (const bad of [new Response('<html>denied</html>', { status: 200 }), new Response('', { status: 200 }), new Response('nope', { status: 403 })]) {
      const fake = fakeKie();
      await withMockedNetwork(async (url, init) => (new URL(url).host === 'tempfile.aiquickdraw.example' ? bad.clone() : fake.handler(url, init)), async () => {
        const result = await mod.generateImage(i2iInput(), 'openai');
        assert.equal(result.success, false);
        assert.equal(result.errorKind, 'download');
      });
    }
  });
});

test('kie 配置缺失：显式 kie 但没 key 报 config，不回落去打 302', async () => {
  await withKie({ KIE_API_KEY: undefined, OPENAI_IMAGE_PROVIDER: 'kie' }, async mod => {
    await withMockedNetwork(async () => { throw new Error('不该发任何请求'); }, async ({ calls }) => {
      const result = await mod.generateImage(i2iInput(), 'openai');
      assert.equal(result.errorKind, 'config');
      assert.equal(calls.length, 0);
    });
  });
});

test('kie 总预算不超过 GPT 服务端单张上限（客户端看门狗按它定）；签名 URL query 被脱敏', () => {
  const src = fs.readFileSync('lib/image-backends.ts', 'utf8');
  assert.match(src, /Math\.min\(input\.timeoutMs \?\? KIE_DEFAULT_TIMEOUT_MS, OPENAI_TIMEOUT_MS\)/);
  assert.ok(kie.KIE_DEFAULT_TIMEOUT_MS <= 360_000);
  const out = backends.sanitizeError('GET https://cdn.example/r.png?X-Amz-Signature=abcdef123&X-Amz-Expires=3600&keep=1 failed');
  assert.doesNotMatch(out, /abcdef123/);
  assert.match(out, /X-Amz-Signature=\*\*\*/);
  assert.match(out, /keep=1/);
  // kie-image 不 import 项目内任何模块
  const kieSrc = fs.readFileSync('lib/kie-image.ts', 'utf8');
  assert.doesNotMatch(kieSrc, /^import /m);
});
