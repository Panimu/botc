// Durable per-device storage for the daily hunt. Values live in localStorage and
// are mirrored to IndexedDB; on load, whichever copy survives restores the other,
// and result histories from both are merged. The browser is also asked (once a
// hunt is finished) to keep the site's data rather than clearing it under storage
// pressure. Everything degrades quietly when storage is unavailable.

const DB_NAME = 'clocktower';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ??= openDb());

async function idb(mode, action) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = action(database.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function localGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function localSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// How two surviving copies of a key are combined.
export const MERGE = {
  // Results are { date: { won, score } }: keep every date from both copies.
  'daily-results': (a, b) => ({ ...b, ...a }),
  // Progress is the in-flight hunt: the later day wins; on the same day, the copy with more actions.
  'daily-progress': (a, b) => {
    if ((a?.date ?? '') !== (b?.date ?? '')) return (a?.date ?? '') > (b?.date ?? '') ? a : b;
    return (a?.actions?.length ?? 0) >= (b?.actions?.length ?? 0) ? a : b;
  },
};

// Reconciles localStorage and IndexedDB for these keys before the page reads them.
export async function restore(keys) {
  for (const key of keys) {
    const local = localGet(key);
    let backup = null;
    try { backup = await idb('readonly', (s) => s.get(key)); } catch {}
    const merged = local && backup ? (MERGE[key] ?? ((a) => a))(local, backup) : local ?? backup;
    if (merged == null) continue;
    if (JSON.stringify(merged) !== JSON.stringify(local)) localSet(key, merged);
    if (JSON.stringify(merged) !== JSON.stringify(backup)) save(key, merged, { localToo: false });
  }
}

export function load(key, fallback) {
  return localGet(key) ?? fallback;
}

export function save(key, value, { localToo = true } = {}) {
  if (localToo) localSet(key, value);
  idb('readwrite', (s) => s.put(value, key)).catch(() => {});
}

// Asks the browser not to evict the site's storage. Some browsers prompt, so
// call it after the player has done something worth keeping, not on load.
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
