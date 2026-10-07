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
  globalThis.__normalizeStub = async (img, label) => {
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
