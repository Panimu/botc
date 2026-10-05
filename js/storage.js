// Durable per-device storage for the daily hunt. Values live in localStorage and
// are mirrored to IndexedDB; on load, whichever copy survives restores the other,
// and result histories from both are merged. The browser is also asked (once a
// hunt is finished) to keep the site's data rather than clearing it under storage
// pressure. Everything degrades quietly when storage is unavailable: an in-memory
// copy, filled by restore() and kept current by save(), answers reads whenever
// localStorage can't, so an IndexedDB-only backup still reaches the page and
// later saves build on it instead of overwriting it.

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
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// Values are copied in and out, so callers can't change the stored copy by mutating what they read.
const memory = new Map();
const copy = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
// Keys whose last localStorage write failed: their localStorage copy (if any) is stale.
const staleLocal = new Set();

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
    memory.set(key, copy(merged));
    if (JSON.stringify(merged) !== JSON.stringify(local) && !localSet(key, merged)) staleLocal.add(key);
    if (JSON.stringify(merged) !== JSON.stringify(backup)) save(key, merged, { localToo: false });
  }
}

export function load(key, fallback) {
  const local = staleLocal.has(key) ? null : localGet(key);
  return local ?? copy(memory.get(key)) ?? fallback;
}

export function save(key, value, { localToo = true } = {}) {
  memory.set(key, copy(value));
  if (localToo) { if (localSet(key, value)) staleLocal.delete(key); else staleLocal.add(key); }
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
