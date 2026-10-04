import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Game, splits } from '../js/engine.js';
import { validate } from '../scripts/validate.js';

const load = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const characters = await load('data/characters.json');
const questions = await load('data/questions.json');

// Deterministic PRNG so failures are reproducible.
function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Answers every question truthfully on behalf of `target`.
function playAs(game, target) {
  let steps = 0;
  while (!game.done) {
    const q = game.current;
    assert.ok(splits(q, game.pool), `question ${q.id} does not split the pool`);
    game.answer(q.yesSet.has(target));
    assert.ok(++steps <= questions.length + characters.length, 'game did not terminate');
  }
  return steps;
}

test('shipped data is valid', () => {
  assert.deepEqual(validate(characters, questions).errors, []);
});

test('truthful play always ends on the target character', () => {
  for (const { id } of characters) {
    for (let seed = 1; seed <= 5; seed++) {
      const game = new Game({ characters, questions, rng: seeded(seed) });
      playAs(game, id);
      assert.equal(game.result.id, id);
    }
  }
});

test('questions can select characters by matching fields', () => {
  const game = new Game({ characters, questions: [{ id: 'q', text: '?', match: { team: ['minion', 'demon'] } }] });
  const evil = characters.filter((c) => c.team === 'minion' || c.team === 'demon').map((c) => c.id);
  assert.deepEqual([...game.questions[0].yesSet].sort(), evil.sort());
});

test('no question is asked twice in one game', () => {
  const game = new Game({ characters, questions, rng: seeded(7) });
  playAs(game, 'imp');
  const ids = game.history.map((h) => h.question.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('undo restores the previous pool and question', () => {
  const game = new Game({ characters, questions, rng: seeded(3) });
  const first = game.current;
  game.answer(true);
  assert.ok(game.undo());
  assert.equal(game.pool.length, characters.length);
  assert.equal(game.current, first);
  assert.equal(game.undo(), false);
});

test('falls back to a direct question when the data cannot separate the pool', () => {
  const two = characters.slice(0, 2);
  const game = new Game({ characters: two, questions: [], rng: seeded(1) });
  assert.ok(game.current.fallback);
  game.answer(false);
  assert.ok(game.done);
  assert.equal(game.result.id, two.find((c) => c.id !== game.history[0].question.yes[0]).id);
});
