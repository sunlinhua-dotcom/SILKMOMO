// 注意:品牌已更名 SILXINE,但以下 localStorage/IndexedDB 键名保持 silkmomo_* 不变——
// 改键名会丢失所有用户的本地工作区数据。切勿重命名。
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
  await db.transaction('rw', db.projects, db.images, db.stylePacks, db.libraryImages, async () => {
    await db.images.clear();
    await db.projects.clear();
    await db.stylePacks.clear();
    await db.libraryImages.clear();
  });
}

function clearLocalStorageWorkspace() {
  for (const key of LOCAL_WORKSPACE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

async function hasLocalWorkspaceData() {
  // localStorage 里的图库/时光机残留也算工作区数据：
  // 旧版本只上传过图库没建过任务的账号，IndexedDB 是空的
  try {
    for (const key of LOCAL_WORKSPACE_KEYS) {
      const v = window.localStorage.getItem(key);
      if (v && v !== '[]') return true;
    }
  } catch {}

  try {
    const { db } = await import('@/lib/db');
    const [projectCount, imageCount, stylePackCount, libraryCount] = await Promise.all([
      db.projects.count(),
      db.images.count(),
      db.stylePacks.count(),
      db.libraryImages.count(),
    ]);
    return projectCount + imageCount + stylePackCount + libraryCount > 0;
  } catch {
    // fail-closed：检查不了就当"有数据"，触发上层 strict 清理，
    // 否则 Dexie 异常时新账号会直接继承上一个账号的本地数据
    return true;
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
