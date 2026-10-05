import { test } from 'node:test';
import assert from 'node:assert/strict';

// A minimal in-memory IndexedDB: just the calls js/storage.js makes.
const backup = new Map();
const request = (run) => {
  const r = {};
  queueMicrotask(() => { r.result = run(); r.onsuccess?.(); });
  return r;
};
const objectStore = {
  get: (key) => request(() => structuredClone(backup.get(key))),
  put: (value, key) => request(() => { backup.set(key, structuredClone(value)); }),
};
globalThis.indexedDB = { open: () => request(() => ({ transaction: () => ({ objectStore: () => objectStore }) })) };

// localStorage that either refuses all access or reads fine but can't be written (quota).
const local = new Map();
let mode = 'denied';
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() {
    if (mode === 'denied') throw new Error('SecurityError');
    return {
      getItem: (key) => local.get(key) ?? null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
  },
});

const { restore, load, save } = await import('../js/storage.js');
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test('without localStorage, the IndexedDB backup reaches the page and later saves keep it', async () => {
  backup.set('daily-results', { '2026-10-01': { won: true, score: 6 } });
  await restore(['daily-results']);
  const results = load('daily-results', {});
  assert.deepEqual(results, { '2026-10-01': { won: true, score: 6 } });

  results['2026-10-02'] = { won: false, score: null };
  assert.equal(load('daily-results', {})['2026-10-02'], undefined, 'mutating a read value does not change the store');
  save('daily-results', results);
  const expected = { '2026-10-01': { won: true, score: 6 }, '2026-10-02': { won: false, score: null } };
  assert.deepEqual(load('daily-results', {}), expected);
  await settle();
  assert.deepEqual(backup.get('daily-results'), expected, 'the backup keeps earlier results');
});

test('when localStorage can be read but not written, its stale copy is not read back', async () => {
  mode = 'quota';
  local.set('daily-progress', JSON.stringify({ date: '2026-10-01', actions: [] }));
  save('daily-progress', { date: '2026-10-02', actions: [{ ask: 'q' }] });
  assert.deepEqual(load('daily-progress', null), { date: '2026-10-02', actions: [{ ask: 'q' }] });
  assert.equal(load('missing-key', 'fallback'), 'fallback');
});
