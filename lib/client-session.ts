const ACTIVE_USERNAME_KEY = 'silkmomo_active_username';
const LOCAL_WORKSPACE_KEYS = [
  'silkmomo_image_library',
  'silkmomo_time_machine',
  'luxury_pack_init',
];
const LOCAL_WORKSPACE_SYNC_TIMEOUT_MS = 6000;

function withWorkspaceTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label}超时`));
    }, LOCAL_WORKSPACE_SYNC_TIMEOUT_MS);
  });

  return Promise.race([
    operation.finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }),
    timeout,
  ]);
}

async function clearIndexedDb() {
  const { db } = await import('@/lib/db');
  await db.open();
  await db.transaction('rw', db.projects, db.images, db.stylePacks, async () => {
    await db.images.clear();
    await db.projects.clear();
    await db.stylePacks.clear();
  });
}

function clearLocalStorageWorkspace() {
  for (const key of LOCAL_WORKSPACE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

async function hasLocalWorkspaceData() {
  try {
    const { db } = await import('@/lib/db');
    const [projectCount, imageCount, stylePackCount] = await Promise.all([
      db.projects.count(),
      db.images.count(),
      db.stylePacks.count(),
    ]);
    return projectCount + imageCount + stylePackCount > 0;
  } catch {
    return false;
  }
}

export async function resetLocalWorkspace(options?: { strict?: boolean }) {
  let indexedDbError: unknown;

  try {
    await clearIndexedDb();
  } catch (e) {
    indexedDbError = e;
    console.warn('清空 IndexedDB 失败:', e);
  }
  try {
    clearLocalStorageWorkspace();
  } catch {}

  if (indexedDbError && options?.strict) {
    throw indexedDbError;
  }
}

export async function syncLocalWorkspaceForUser(username: string, options?: { forceReset?: boolean }) {
  if (typeof window === 'undefined') return;

  const previousUsername = window.localStorage.getItem(ACTIVE_USERNAME_KEY);
  const shouldReset =
    options?.forceReset ||
    (previousUsername !== null && previousUsername !== username) ||
    (previousUsername === null && await withWorkspaceTimeout(
      hasLocalWorkspaceData(),
      '检查本地工作区'
    ));

  if (shouldReset) {
    await withWorkspaceTimeout(
      resetLocalWorkspace({ strict: true }),
      '清理本地工作区'
    );
  }

  window.localStorage.setItem(ACTIVE_USERNAME_KEY, username);
}

export async function clearLocalWorkspaceSession() {
  await resetLocalWorkspace();
  try {
    window.localStorage.removeItem(ACTIVE_USERNAME_KEY);
  } catch {}
}
