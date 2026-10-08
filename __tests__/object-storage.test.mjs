import assert from 'node:assert/strict';
import test from 'node:test';

const {
  ObjectNotFoundError, ObjectStorageError, createObjectStorage,
  getObjectStorage, isObjectStorageEnabled, readObjectStorageConfig,
} = await import('../lib/object-storage.ts');

const FULL_ENV = {
  OBJECT_STORAGE_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
  OBJECT_STORAGE_BUCKET: 'silkmomo-faces',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'AKIATESTKEYID123456',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'super-secret-value-do-not-leak',
};

test('四个必填变量缺任何一个都等于未启用', () => {
  assert.ok(readObjectStorageConfig(FULL_ENV));
  assert.equal(isObjectStorageEnabled(FULL_ENV), true);
  for (const name of Object.keys(FULL_ENV)) {
    const env = { ...FULL_ENV, [name]: undefined };
    assert.equal(readObjectStorageConfig(env), null, `缺 ${name} 应未启用`);
    assert.equal(getObjectStorage(env), null);
    assert.equal(readObjectStorageConfig({ ...FULL_ENV, [name]: '   ' }), null, `${name} 为空白应未启用`);
  }
  assert.equal(readObjectStorageConfig({}), null);
});

test('region 默认 auto，endpoint 去掉尾部斜杠，非法 endpoint 视为未启用', () => {
  const config = readObjectStorageConfig(FULL_ENV);
  assert.equal(config.region, 'auto');
  assert.equal(config.endpoint, 'https://acct.r2.cloudflarestorage.com');
  assert.equal(readObjectStorageConfig({ ...FULL_ENV, OBJECT_STORAGE_REGION: 'us-east-1' }).region, 'us-east-1');
  assert.equal(readObjectStorageConfig({ ...FULL_ENV, OBJECT_STORAGE_ENDPOINT: 'not a url' }), null);
  assert.equal(readObjectStorageConfig({ ...FULL_ENV, OBJECT_STORAGE_ENDPOINT: 'ftp://x.example' }), null);
});

/** 内存 S3：只实现路径式 PUT/GET/DELETE，并记录每次请求。failures 里的数字 = 返回该 HTTP 状态，Error = 抛出。 */
function fakeS3({ failures = [] } = {}) {
  const objects = new Map();
  const calls = [];
  const queue = [...failures];
  const fetch = async (input, init = {}) => {
    // 真实 fetch 收到 (url 字符串, { method, headers, body })；body 必须是带长度的 Buffer/字节数组而不是流（否则 S3 回 411）
    assert.equal(typeof input, 'string');
    if (init.method === 'PUT') assert.ok(init.body instanceof Uint8Array, 'PUT 的 body 必须是字节数组，不能是流');
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, path: url.pathname, auth: request.headers.get('authorization') });
    const planned = queue.shift();
    if (planned instanceof Error) throw planned;
    if (typeof planned === 'number') {
      return new Response(
        `<Error><Code>InternalError</Code><Message>secret=${FULL_ENV.OBJECT_STORAGE_SECRET_ACCESS_KEY}</Message></Error>`,
        { status: planned },
      );
    }
    if (request.method === 'PUT') {
      objects.set(url.pathname, Buffer.from(await request.arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (request.method === 'GET') {
      const body = objects.get(url.pathname);
      return body ? new Response(body, { status: 200 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    }
    if (request.method === 'DELETE') {
      objects.delete(url.pathname);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  return { fetch, objects, calls };
}

const config = readObjectStorageConfig(FULL_ENV);
const noSleep = async () => {};

test('PUT / GET / DELETE 走路径式地址并带 SigV4 签名', async () => {
  const s3 = fakeS3();
  const storage = createObjectStorage(config, { fetch: s3.fetch, sleep: noSleep });
  const body = Buffer.from([1, 2, 3, 250, 255]);
  await storage.put('model-faces/u1/f1/image.jpg', body, 'image/jpeg');
  assert.equal(s3.calls[0].path, '/silkmomo-faces/model-faces/u1/f1/image.jpg');
  assert.match(s3.calls[0].auth, /^AWS4-HMAC-SHA256 Credential=AKIATESTKEYID123456\//);
  assert.deepEqual(await storage.get('model-faces/u1/f1/image.jpg'), body);
  await storage.delete('model-faces/u1/f1/image.jpg');
  assert.equal(s3.objects.size, 0);
  await storage.delete('model-faces/u1/f1/image.jpg'); // 不存在也算成功
});

test('GET 404 抛 ObjectNotFoundError 且不重试', async () => {
  const s3 = fakeS3();
  const storage = createObjectStorage(config, { fetch: s3.fetch, sleep: noSleep });
  await assert.rejects(storage.get('nope.jpg'), ObjectNotFoundError);
  assert.equal(s3.calls.length, 1);
});

test('5xx 与网络错误最多重试 2 次，之后成功就返回', async () => {
  const s3 = fakeS3({ failures: [503, new TypeError('fetch failed')] });
  const storage = createObjectStorage(config, { fetch: s3.fetch, sleep: noSleep });
  await storage.put('a.jpg', Buffer.from('x'), 'image/jpeg');
  assert.equal(s3.calls.length, 3);
  assert.equal(s3.objects.size, 1);
});

test('三次都失败才抛错；403 这类 4xx 不重试', async () => {
  const bad = fakeS3({ failures: [500, 502, 503, 500] });
  const storage = createObjectStorage(config, { fetch: bad.fetch, sleep: noSleep });
  await assert.rejects(storage.put('a.jpg', Buffer.from('x'), 'image/jpeg'), ObjectStorageError);
  assert.equal(bad.calls.length, 3);

  const denied = fakeS3({ failures: [403] });
  const storage2 = createObjectStorage(config, { fetch: denied.fetch, sleep: noSleep });
  await assert.rejects(storage2.get('a.jpg'), error => error instanceof ObjectStorageError && error.status === 403);
  assert.equal(denied.calls.length, 1);
});

test('错误信息脱敏：不含密钥、签名、查询串，S3 错误体的 Message 不回显', async () => {
  const leak = new Error(
    `connect failed ${FULL_ENV.OBJECT_STORAGE_SECRET_ACCESS_KEY} ${FULL_ENV.OBJECT_STORAGE_ACCESS_KEY_ID} `
    + 'https://acct.r2.cloudflarestorage.com/x?X-Amz-Signature=deadbeef',
  );
  const net = fakeS3({ failures: [leak, leak, leak] });
  const s1 = createObjectStorage(config, { fetch: net.fetch, sleep: noSleep });
  const e1 = await s1.get('k.jpg').catch(e => e);
  const http = fakeS3({ failures: [500, 500, 500] });
  const s2 = createObjectStorage(config, { fetch: http.fetch, sleep: noSleep });
  const e2 = await s2.get('k.jpg').catch(e => e);
  for (const error of [e1, e2]) {
    assert.ok(error instanceof ObjectStorageError);
    const text = `${error.message}\n${error.stack}`;
    for (const forbidden of [
      FULL_ENV.OBJECT_STORAGE_SECRET_ACCESS_KEY, FULL_ENV.OBJECT_STORAGE_ACCESS_KEY_ID,
      'X-Amz-Signature', 'deadbeef', 'Authorization',
    ]) {
      assert.ok(!text.includes(forbidden), `错误信息泄漏了 ${forbidden}`);
    }
  }
  assert.match(e2.message, /HTTP 500 InternalError/);
});

test('单次尝试有超时，卡住的请求会被中止', async () => {
  const hang = (_request, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const storage = createObjectStorage(config, { fetch: hang, timeoutMs: 30, retries: 0, sleep: noSleep });
  const started = Date.now();
  await assert.rejects(storage.get('k.jpg'), /AbortError/);
  assert.ok(Date.now() - started < 2_000);
});
