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

test('practice progress: the same session keeps the longer history; a different session goes to the newer start', () => {
  const merge = MERGE['daily-practice-progress'];
  const one = { date: '2026-10-05', startedAt: 100, actions: [{ ask: 'a' }] };
  const two = { date: '2026-10-05', startedAt: 100, actions: [{ ask: 'a' }, { ask: 'b' }] };
  assert.equal(merge(one, two), two);
  assert.equal(merge(two, one), two);
  const restarted = { date: '2026-10-05', startedAt: 300, actions: [{ ask: 'c' }] };
  assert.equal(merge(two, restarted), restarted, 'a newer session on the same date wins even with fewer moves');
  const otherDay = { date: '2026-10-07', startedAt: 200, actions: [] };
  assert.equal(merge(otherDay, two), otherDay);
  assert.equal(merge(restarted, otherDay), restarted);
});

test('plain wording: hard rules are errors, length and double negatives are warnings', async () => {
  const { plainWording } = await import('../scripts/validate.js');
  assert.deepEqual(plainWording('Are you on the evil team?'), { errors: [], warnings: [] });
  for (const bad of ['Are you evil', 'Are you evil? Or good?', 'Are you (mostly) evil?', 'Are you evil; truly?', 'Can you ask a yes/no question?', 'Do you wake, e.g. at night?', 'Does the ST wake you?', `Are you ${'very '.repeat(30)}evil?`]) {
    assert.ok(plainWording(bad).errors.length, `should reject: ${bad}`);
  }
  assert.ok(plainWording(`Are you ${'very '.repeat(20)}evil?`).warnings.some((w) => w.includes('words')));
  assert.ok(plainWording("Can't you not die?").warnings.some((w) => w.includes('double negative')));
});

test('the validator rejects two questions with the same plain or styled text', async () => {
  const { checkQuestions } = await import('../scripts/validate.js');
  const { loadData } = await import('../scripts/load.js');
  const { characters } = await loadData();
  const base = { voice: 'The Host', yes: [characters[0].id] };
  const errors = checkQuestions([
    { ...base, id: 'a', plain: 'Are you the first character?', styled: 'One?' },
    { ...base, id: 'b', plain: 'Are you the first character?', styled: 'Two?' },
    { ...base, id: 'c', plain: 'Are you really the first character?', styled: 'Two?' },
  ], characters);
  assert.ok(errors.some((e) => e.includes('Question b') && e.includes('"plain" text duplicates')));
  assert.ok(errors.some((e) => e.includes('Question c') && e.includes('"styled" text duplicates')));
});

test('the validator rejects a second question with the same split, even asked the other way round', async () => {
  const { checkQuestions } = await import('../scripts/validate.js');
  const { loadData } = await import('../scripts/load.js');
  const { characters } = await loadData();
  const [a, b] = characters;
  const base = { voice: 'The Host' };
  const errors = checkQuestions([
    { ...base, id: 'one', plain: 'Are you the first or second character?', styled: 'One?', yes: [a.id, b.id] },
    { ...base, id: 'two', plain: 'Are you one of those two characters?', styled: 'Two?', yes: [b.id, a.id] },
    { ...base, id: 'three', plain: 'Are you anyone but those two?', styled: 'Three?', yes: characters.slice(2).map((c) => c.id) },
  ], characters);
  assert.ok(errors.some((e) => e.includes('Question two') && e.includes('splits exactly like one')));
  assert.ok(errors.some((e) => e.includes('Question three') && e.includes('splits exactly like one')));
});

test('trait rules shared with the editor reject what the upload validator rejects', async () => {
  const { traitProblems } = await import('../scripts/validate.js');
  const ids = new Set(['imp', 'vortox', 'chef']);
  const definition = 'A character that is only a test of the rules.';
  assert.deepEqual(traitProblems('testTrait', { definition, yes: ['imp', 'vortox'], no: ['chef'] }, ids), []);
  assert.ok(traitProblems('kills2', { definition, yes: ['imp', 'vortox'] }, ids).some((p) => p.includes('camelCase')));
  assert.ok(traitProblems('testTrait', { definition: 'Too short.', yes: ['imp', 'vortox'] }, ids).some((p) => p.includes('definition')));
  assert.ok(traitProblems('testTrait', { definition, yes: [] }, ids).some((p) => p.includes('yes list')));
  assert.ok(traitProblems('testTrait', { definition, yes: 'imp' }, ids).some((p) => p.includes('yes list')));
  assert.ok(traitProblems('testTrait', { definition, yes: ['imp', 'nobody'] }, ids).some((p) => p.includes('nobody')));
  assert.ok(traitProblems('testTrait', { definition, yes: ['imp', 'vortox'], no: ['imp'] }, ids).some((p) => p.includes('both')));
});
