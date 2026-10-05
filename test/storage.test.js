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
  delete: (key) => request(() => { backup.delete(key); }),
  getAllKeys: () => request(() => [...backup.keys()]),
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

const { restore, load, save, remove, storedKeys } = await import('../js/storage.js');
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

test('with localStorage full, reloading keeps the newer practice progress from IndexedDB', async () => {
  mode = 'quota';
  const stale = { date: '2026-10-05', startedAt: 100, actions: [{ ask: 'a' }] };
  const newer = { date: '2026-10-05', startedAt: 100, actions: [{ ask: 'a' }, { ask: 'b' }] };
  local.set('daily-practice-progress', JSON.stringify(stale));
  backup.set('daily-practice-progress', newer);
  await restore(['daily-practice-progress']);
  assert.deepEqual(load('daily-practice-progress', null), newer);
  await settle();
  assert.deepEqual(backup.get('daily-practice-progress'), newer, 'the backup is not overwritten with the stale copy');
});

test("an older tab saving the previous day's hunt leaves today's progress alone", async () => {
  mode = 'denied';
  const today = { date: '2026-10-06', startedAt: 2, actions: [{ ask: 'a' }, { ask: 'b' }] };
  save('daily-progress:2026-10-06', today);
  save('daily-progress:2026-10-05', { date: '2026-10-05', startedAt: 1, actions: [{ ask: 'old' }] });
  await settle();
  assert.deepEqual(load('daily-progress:2026-10-06', null), today);
  assert.deepEqual(backup.get('daily-progress:2026-10-06'), today);
});

test('per-day progress keys merge like daily progress, and old keys can be pruned', async () => {
  mode = 'quota';
  const longer = { date: '2026-10-07', startedAt: 5, actions: [{ ask: 'a' }, { ask: 'b' }] };
  local.set('daily-progress:2026-10-07', JSON.stringify({ date: '2026-10-07', startedAt: 5, actions: [{ ask: 'a' }] }));
  backup.set('daily-progress:2026-10-07', longer);
  await restore(['daily-progress:2026-10-07']);
  assert.deepEqual(load('daily-progress:2026-10-07', null), longer);

  assert.ok((await storedKeys()).includes('daily-progress:2026-10-05'));
  remove('daily-progress:2026-10-05');
  await settle();
  assert.ok(!(await storedKeys()).includes('daily-progress:2026-10-05'));
  assert.equal(load('daily-progress:2026-10-05', null), null);
});
