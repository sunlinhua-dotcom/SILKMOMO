const ACTIVE_USERNAME_KEY = 'silkmomo_active_username';
const LOCAL_WORKSPACE_KEYS = [
  'silkmomo_image_library',
  'silkmomo_time_machine',
  'luxury_pack_init',
];

async function clearIndexedDb() {
  const { db } = await import('@/lib/db');
  db.close();
  await db.delete();
  await db.open();
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

export async function resetLocalWorkspace() {
  try {
    await clearIndexedDb();
  } catch (e) {
    console.warn('清空 IndexedDB 失败:', e);
  }
  try {
    clearLocalStorageWorkspace();
  } catch {}
}

export async function syncLocalWorkspaceForUser(username: string, options?: { forceReset?: boolean }) {
  if (typeof window === 'undefined') return;

  const previousUsername = window.localStorage.getItem(ACTIVE_USERNAME_KEY);
  const shouldReset =
    options?.forceReset ||
    (previousUsername !== null && previousUsername !== username) ||
    (previousUsername === null && await hasLocalWorkspaceData());

  if (shouldReset) {
    await resetLocalWorkspace();
  }

  window.localStorage.setItem(ACTIVE_USERNAME_KEY, username);
}

export async function clearLocalWorkspaceSession() {
  await resetLocalWorkspace();
  try {
    window.localStorage.removeItem(ACTIVE_USERNAME_KEY);
  } catch {}
}
