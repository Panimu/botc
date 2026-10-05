import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MERGE } from '../js/storage.js';
import { BANNED_PATTERNS } from '../scripts/build-site.js';

test('stored hunt progress: a later day beats more actions from an earlier day', () => {
  const merge = MERGE['daily-progress'];
  const today = { date: '2026-10-06', actions: [{ ask: 'a' }] };
  const yesterday = { date: '2026-10-05', actions: Array(10).fill({ ask: 'b' }) };
  assert.equal(merge(today, yesterday), today);
  assert.equal(merge(yesterday, today), today);
  const moreToday = { date: '2026-10-06', actions: [{ ask: 'a' }, { ask: 'c' }] };
  assert.equal(merge(today, moreToday), moreToday, 'same day: more actions wins');
});

test('the banned-name check catches plurals and possessives but not words that merely contain a name', () => {
  const hit = (text) => BANNED_PATTERNS.some((re) => re.test(text));
  for (const text of ['a pack of Donuts', "Carl's idea", 'the Carls of this town', 'brave crawlers', 'ask Elle', 'MONGO!']) {
    assert.ok(hit(text), `should catch: ${text}`);
  }
  for (const text of ['the Scarlet Woman', 'excellent', 'Ellen', 'zeal']) {
    assert.ok(!hit(text), `should not catch: ${text}`);
  }
});
