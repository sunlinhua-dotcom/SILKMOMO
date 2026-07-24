export interface FaceSwapImageInput {
  data: string;
  mimeType: string;
}

export interface ParsedFaceSwap302Response {
  imageUrl?: string;
  taskId?: string;
  status?: string;
  error?: string;
}

const FACE_SWAP_SUBMIT_URL = 'https://api.302.ai/302/submit/face-swap-v2';
const FACE_SWAP_TASK_URL_PREFIX = 'https://api.302.ai/302/task';
const FACE_SWAP_TIMEOUT_MS = 150_000;
const FACE_SWAP_POLL_INTERVAL_MS = 2_500;

function get302ApiKey(): string {
  return process.env.OPENAI_IMAGE_API_KEY || process.env.GEMINI_API_KEY || '';
}

function sanitizeForLog(value: string): string {
  let out = value;
  const keys = [process.env.OPENAI_IMAGE_API_KEY, process.env.GEMINI_API_KEY].filter(Boolean) as string[];
  for (const key of keys) out = out.split(key).join('***');
  return out;
}

function truncateForLog(value: string, maxLength = 600): string {
  const sanitized = sanitizeForLog(value);
  return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}...` : sanitized;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const str = stringValue(value);
    if (str) return str;
  }
  return undefined;
}

function imageUrlFromArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const url = stringValue(item);
    if (url) return url;
    const record = asRecord(item);
    const nestedUrl = firstString(record?.url, record?.image_url, record?.result_url);
    if (nestedUrl) return nestedUrl;
  }
  return undefined;
}

export function parseFaceSwap302Response(payload: unknown): ParsedFaceSwap302Response {
  const root = asRecord(payload);
  if (!root) return {};

  const data = asRecord(root.data);
  const image = asRecord(root.image);
  const dataImage = asRecord(data?.image);
  const output = asRecord(root.output);
  const dataOutput = asRecord(data?.output);
  const result = asRecord(root.result);
  const dataResult = asRecord(data?.result);
  const task = asRecord(root.task);
  const dataTask = asRecord(data?.task);
  const error = asRecord(root.error) || asRecord(data?.error);

  const imageUrl = firstString(
    image?.url,
    dataImage?.url,
    root.url,
    root.image_url,
    root.result_url,
    data?.url,
    data?.image_url,
    data?.result_url,
    output?.url,
    output?.image_url,
    output?.result_url,
    dataOutput?.url,
    dataOutput?.image_url,
    dataOutput?.result_url,
    result?.url,
    result?.image_url,
    result?.result_url,
    dataResult?.url,
    dataResult?.image_url,
    dataResult?.result_url,
    imageUrlFromArray(root.images),
    imageUrlFromArray(data?.images),
    imageUrlFromArray(output?.images),
    imageUrlFromArray(dataOutput?.images),
    imageUrlFromArray(result?.images),
    imageUrlFromArray(dataResult?.images),
  );

  const taskId = firstString(
    root.task_id,
    root.taskId,
    root.id,
    data?.task_id,
    data?.taskId,
    data?.id,
    task?.id,
    task?.task_id,
    task?.taskId,
    dataTask?.id,
    dataTask?.task_id,
    dataTask?.taskId,
  );

  const status = firstString(root.status, data?.status, task?.status, dataTask?.status);
  const errorMessage = firstString(
    error?.message,
    error?.message_cn,
    root.message,
    data?.message,
    root.error,
    data?.error,
  );

  return {
    ...(imageUrl ? { imageUrl } : {}),
    ...(taskId && !imageUrl ? { taskId } : {}),
    ...(status ? { status } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}

function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.toLowerCase() || 'png';
  if (subtype === 'jpeg') return 'jpg';
  return subtype.replace(/[^a-z0-9]/g, '') || 'png';
}

function appendImage(formData: FormData, fieldName: string, image: FaceSwapImageInput, basename: string): void {
  const buffer = Buffer.from(image.data, 'base64');
  const blob = new Blob([buffer], { type: image.mimeType || 'image/png' });
  formData.append(fieldName, blob, `${basename}.${extensionForMime(image.mimeType || 'image/png')}`);
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function timeoutSignal(deadline: number): AbortSignal {
  const ms = remainingMs(deadline);
  if (ms <= 0) throw new Error('face-swap-v2 timeout');
  return AbortSignal.timeout(ms);
}

function isTerminalFailureStatus(status: string | undefined): boolean {
  return /^(failed|failure|error|cancelled|canceled|timeout|expired)$/i.test(status || '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseJsonResponse(response: Response, context: string): Promise<unknown | null> {
  const rawText = await response.text().catch(err => {
    throw new Error(`${context} read failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  if (!response.ok) {
    console.log(`[face-swap-v2] ${context} failed HTTP ${response.status}: ${truncateForLog(rawText)}`);
    return null;
  }
  try {
    return JSON.parse(rawText);
  } catch (err) {
    console.log(`[face-swap-v2] ${context} JSON parse failed: ${truncateForLog(err instanceof Error ? err.message : String(err))}; body=${truncateForLog(rawText)}`);
    return null;
  }
}

async function submitFaceSwap(base: FaceSwapImageInput, face: FaceSwapImageInput, apiKey: string, deadline: number): Promise<ParsedFaceSwap302Response | null> {
  const formData = new FormData();
  appendImage(formData, 'base_image_url', base, 'base');
  appendImage(formData, 'swap_image_url', face, 'swap');

  const response = await fetch(FACE_SWAP_SUBMIT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: timeoutSignal(deadline),
    cache: 'no-store',
  });
  const payload = await parseJsonResponse(response, 'submit');
  return payload ? parseFaceSwap302Response(payload) : null;
}

async function fetchTask(taskId: string, apiKey: string, deadline: number): Promise<ParsedFaceSwap302Response | null> {
  const response = await fetch(`${FACE_SWAP_TASK_URL_PREFIX}/${encodeURIComponent(taskId)}/fetch`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: timeoutSignal(deadline),
    cache: 'no-store',
  });
  const payload = await parseJsonResponse(response, `task ${taskId}`);
  return payload ? parseFaceSwap302Response(payload) : null;
}

async function pollTaskForImageUrl(taskId: string, apiKey: string, deadline: number): Promise<string | null> {
  let lastStatus = '';
  while (remainingMs(deadline) > 0) {
    const parsed = await fetchTask(taskId, apiKey, deadline);
    if (!parsed) return null;
    if (parsed.imageUrl) return parsed.imageUrl;
    lastStatus = parsed.status || lastStatus;
    if (isTerminalFailureStatus(parsed.status)) {
      console.log(`[face-swap-v2] task ${taskId} failed status=${parsed.status}: ${truncateForLog(parsed.error || '')}`);
      return null;
    }
    await sleep(Math.min(FACE_SWAP_POLL_INTERVAL_MS, remainingMs(deadline)));
  }
  console.log(`[face-swap-v2] task ${taskId} timeout after ${Math.round(FACE_SWAP_TIMEOUT_MS / 1000)}s, lastStatus=${lastStatus || 'unknown'}`);
  return null;
}

async function downloadImageAsBase64(url: string, deadline: number): Promise<string | null> {
  const response = await fetch(url, {
    method: 'GET',
    signal: timeoutSignal(deadline),
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.log(`[face-swap-v2] download failed HTTP ${response.status}: ${truncateForLog(body)}`);
    return null;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType && !contentType.startsWith('image/')) {
    const body = await response.text().catch(() => '');
    console.log(`[face-swap-v2] download returned non-image ${contentType}: ${truncateForLog(body)}`);
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    console.log('[face-swap-v2] download returned empty image');
    return null;
  }
  return buffer.toString('base64');
}

export async function swapFaceVia302(
  base: FaceSwapImageInput,
  face: FaceSwapImageInput,
): Promise<{ data: string } | null> {
  const apiKey = get302ApiKey();
  if (!apiKey) {
    console.log('[face-swap-v2] skip: 302 API key is not configured');
    return null;
  }

  const deadline = Date.now() + FACE_SWAP_TIMEOUT_MS;
  try {
    const submitted = await submitFaceSwap(base, face, apiKey, deadline);
    if (!submitted) return null;
    if (submitted.error) {
      console.log(`[face-swap-v2] submit returned error: ${truncateForLog(submitted.error)}`);
    }

    const imageUrl = submitted.imageUrl
      || (submitted.taskId ? await pollTaskForImageUrl(submitted.taskId, apiKey, deadline) : null);
    if (!imageUrl) {
      console.log(`[face-swap-v2] no image URL returned${submitted.taskId ? ` for task ${submitted.taskId}` : ''}`);
      return null;
    }

    const data = await downloadImageAsBase64(imageUrl, deadline);
    return data ? { data } : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[face-swap-v2] failed: ${truncateForLog(message)}`);
    return null;
  }
}
