/**
 * S3 兼容对象存储（Cloudflare R2 / MinIO / AWS S3）的最小客户端：PUT / GET / DELETE 三个动作。
 *
 * - 签名用 aws4fetch（SigV4，几 KB），不引 @aws-sdk。
 * - 配置只读环境变量，四个必填项缺任何一个 = 未启用（getObjectStorage() 返回 null，
 *   调用方走原来的「存库」路径，行为与没有这个文件时完全一致）：
 *     OBJECT_STORAGE_ENDPOINT / OBJECT_STORAGE_BUCKET /
 *     OBJECT_STORAGE_ACCESS_KEY_ID / OBJECT_STORAGE_SECRET_ACCESS_KEY
 *   可选 OBJECT_STORAGE_REGION（默认 auto，R2 用 auto）。
 * - 路径式寻址：`<endpoint>/<bucket>/<key>`（R2、MinIO 都支持）。
 * - 三个动作都是幂等的，网络错误 / 超时 / 408 / 429 / 5xx 最多重试 2 次（共 3 次尝试）。
 * - 错误脱敏：抛出的 ObjectStorageError 只含动作、key、HTTP 状态与 S3 错误码，
 *   绝不含 URL 查询串、请求头、签名或密钥（message 里出现密钥串也会被替换掉）。
 *
 * 本文件刻意不 import `@/`，以便 node --test 直接加载。
 */
import { AwsClient } from 'aws4fetch';

export interface ObjectStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export class ObjectStorageError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, opts: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ObjectStorageError';
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

export class ObjectNotFoundError extends ObjectStorageError {
  constructor(key: string) {
    super(`object not found: ${key}`, { status: 404, retryable: false });
    this.name = 'ObjectNotFoundError';
  }
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** 对象不存在也算成功（DELETE 幂等）。 */
  delete(key: string): Promise<void>;
}

export interface ObjectStorageOptions {
  fetch?: typeof fetch;
  /** 单次尝试超时，默认 15 秒。 */
  timeoutMs?: number;
  /** 失败后的重试次数，默认 2。 */
  retries?: number;
  /** 退避等待，测试注入。 */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const BACKOFF_BASE_MS = 250;

type Env = Record<string, string | undefined>;

let warnedInvalidEndpoint = false;

/** 四个必填变量齐全且 endpoint 合法才返回配置，否则 null（= 未启用）。 */
export function readObjectStorageConfig(env: Env = process.env): ObjectStorageConfig | null {
  const endpointRaw = env.OBJECT_STORAGE_ENDPOINT?.trim();
  const bucket = env.OBJECT_STORAGE_BUCKET?.trim();
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!endpointRaw || !bucket || !accessKeyId || !secretAccessKey) return null;

  let endpoint: string;
  try {
    const url = new URL(endpointRaw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
    endpoint = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    if (!warnedInvalidEndpoint) {
      warnedInvalidEndpoint = true;
      console.warn('[object-storage] OBJECT_STORAGE_ENDPOINT 不是合法的 http(s) 地址，对象存储保持未启用');
    }
    return null;
  }
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.OBJECT_STORAGE_REGION?.trim() || 'auto',
  };
}

export function isObjectStorageEnabled(env: Env = process.env): boolean {
  return readObjectStorageConfig(env) !== null;
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function redact(text: string, config: ObjectStorageConfig): string {
  let out = text;
  for (const secret of [config.secretAccessKey, config.accessKeyId]) {
    if (secret) out = out.split(secret).join('***');
  }
  return out;
}

/** 从 S3 错误 XML 里只取 <Code>，不带 Message（Message 可能回显请求细节）。 */
function s3ErrorCode(body: string): string | null {
  const match = /<Code>([A-Za-z0-9_.-]{1,64})<\/Code>/.exec(body);
  return match ? match[1] : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createObjectStorage(
  config: ObjectStorageConfig,
  options: ObjectStorageOptions = {},
): ObjectStorage {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });

  const urlFor = (key: string) => `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodeKey(key)}`;

  async function attempt(
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    signal: AbortSignal,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    // 每次尝试都重新签名：时间戳新鲜，且 body 流只能消费一次
    const signed = await client.sign(urlFor(key), {
      method,
      headers,
      body: body as BodyInit | undefined,
    });
    // 不能直接把 signed(Request) 交给 fetch：Request 会把 body 变成流，undici 随即改用
    // chunked 传输、不带 Content-Length，S3/R2 回 411 MissingContentLength（e2e 实测踩到）。
    // 所以只取它算好的 url + 签名头，body 仍以原始 Buffer 传，由 fetch 自己写出 Content-Length。
    return fetchImpl(signed.url, { method, headers: signed.headers, body: body as BodyInit | undefined, signal });
  }

  async function run<T>(
    action: string,
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    handle: (response: Response) => Promise<T>,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<T> {
    let lastError: ObjectStorageError | null = null;
    for (let tryNo = 0; tryNo <= retries; tryNo++) {
      if (tryNo > 0) await sleep(BACKOFF_BASE_MS * 2 ** (tryNo - 1));
      // 超时同时覆盖「等响应头」和「读响应体」
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await attempt(method, key, controller.signal, body, contentType);
        return await handle(response);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) throw error;
        if (error instanceof ObjectStorageError) {
          lastError = error;
          if (!error.retryable) throw error;
          continue;
        }
        // 网络层错误 / 超时（AbortError）：只保留错误名，不带 message（可能含 URL）
        const name = error instanceof Error ? error.name : 'Error';
        const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
        lastError = new ObjectStorageError(
          `${action} ${key} failed: ${name}${code ? ` (${code})` : ''}`,
          { retryable: true },
        );
      } finally {
        clearTimeout(timer);
      }
    }
    const final = lastError ?? new ObjectStorageError(`${action} ${key} failed`);
    throw new ObjectStorageError(redact(`${final.message} (after ${retries + 1} attempts)`, config), {
      status: final.status,
      retryable: false,
    });
  }

  async function failure(action: string, key: string, response: Response): Promise<ObjectStorageError> {
    let code: string | null = null;
    try {
      code = s3ErrorCode((await response.text()).slice(0, 2_000));
    } catch {
      // 读不到错误体不影响判断
    }
    return new ObjectStorageError(
      redact(`${action} ${key} failed: HTTP ${response.status}${code ? ` ${code}` : ''}`, config),
      { status: response.status, retryable: isRetryableStatus(response.status) },
    );
  }

  return {
    put: (key, body, contentType) =>
      run('PUT', 'PUT', key, async response => {
        if (!response.ok) throw await failure('PUT', key, response);
        await response.arrayBuffer().catch(() => undefined);
      }, body, contentType),

    get: key =>
      run('GET', 'GET', key, async response => {
        if (response.status === 404) throw new ObjectNotFoundError(key);
        if (!response.ok) throw await failure('GET', key, response);
        return Buffer.from(await response.arrayBuffer());
      }),

    delete: key =>
      run('DELETE', 'DELETE', key, async response => {
        if (response.status === 404) return;
        if (!response.ok) throw await failure('DELETE', key, response);
        await response.arrayBuffer().catch(() => undefined);
      }),
  };
}

let cached: { signature: string; storage: ObjectStorage } | null = null;

/** 进程内单例；环境变量未配齐返回 null。 */
export function getObjectStorage(env: Env = process.env): ObjectStorage | null {
  const config = readObjectStorageConfig(env);
  if (!config) return null;
  const signature = [config.endpoint, config.bucket, config.accessKeyId, config.secretAccessKey, config.region].join('\n');
  if (cached?.signature === signature) return cached.storage;
  const storage = createObjectStorage(config);
  cached = { signature, storage };
  return storage;
}
