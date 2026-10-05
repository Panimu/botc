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

test('the service worker precaches every asset the pages and scripts load by a fixed URL', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { precacheList } = await import('../scripts/build-site.js');
  const list = new Set(await precacheList('dev'));
  const wanted = new Set(['./', 'index.html', 'quiz.html']);
  for (const page of ['index.html', 'quiz.html']) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    for (const [, url] of html.matchAll(/(?:href|src)="([^":]+\?v=dev)"/g)) wanted.add(url);
  }
  for (const file of (await readdir(new URL('../js/', import.meta.url))).filter((name) => name.endsWith('.js'))) {
    const source = await readFile(new URL(`../js/${file}`, import.meta.url), 'utf8');
    for (const [, url] of source.matchAll(/from '\.\/([^']+\?v=dev)'/g)) wanted.add(`js/${url}`);
    for (const [, url] of source.matchAll(/loadJson\('([^'$]+\?v=dev)'\)/g)) wanted.add(url);
  }
  for (const url of wanted) assert.ok(list.has(url), `not precached: ${url}`);
});
