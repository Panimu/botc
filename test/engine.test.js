import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, prepare, splits } from '../js/engine.js';
import { checkCharacters, checkQuestions } from '../scripts/validate.js';
import { loadData } from '../scripts/load.js';

const { characters, questions } = await loadData();

// Deterministic PRNG so failures are reproducible.
function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Answers every question truthfully on behalf of `target`.
function playAs(game, target) {
  let steps = 0;
  while (!game.done) {
    const q = game.current;
    assert.ok(splits(q, game.pool), `question ${q.id} does not apply to the pool`);
    game.answer(q.yesSet.has(target));
    assert.ok(++steps <= questions.length + characters.length, 'game did not terminate');
  }
  return steps;
}

const q = (fields) => ({ id: 'q', plain: '?', dinniman: '?', voice: 'Carl', ...fields });

test('shipped data is valid', () => {
  assert.deepEqual(checkCharacters(characters), []);
  assert.deepEqual(checkQuestions(questions, characters), []);
});

test('truthful play always ends on the target character', () => {
  for (const { id } of characters) {
    for (let seed = 1; seed <= 3; seed++) {
      const game = new Game({ characters, questions, rng: seeded(seed) });
      playAs(game, id);
      assert.equal(game.result.id, id);
    }
  }
});

test('questions can select characters by matching fields', () => {
  const evil = characters.filter((c) => c.team === 'minion' || c.team === 'demon').map((c) => c.id);
  assert.deepEqual([...prepare(q({ yes: { team: ['minion', 'demon'] } }), characters).yesSet].sort(), evil.sort());
});

test('scoped questions only apply when the whole pool is inside the scope', () => {
  const scoped = prepare(q({ yes: ['imp'], scope: ['imp', 'po', 'zombuul'] }), characters);
  assert.ok(splits(scoped, ['imp', 'po', 'zombuul']));
  assert.ok(splits(scoped, ['imp', 'zombuul']));
  assert.ok(!splits(scoped, ['po', 'zombuul']), 'nobody on the yes side');
  assert.ok(!splits(scoped, ['imp', 'po', 'chef']), 'chef is outside the scope');
});

test('validator rejects yes characters outside the scope and questions that never split', () => {
  const errors = checkQuestions([
    q({ id: 'a', plain: 'a', dinniman: 'a', yes: ['chef'], scope: ['imp', 'po'] }),
    q({ id: 'b', plain: 'b', dinniman: 'b', yes: ['imp', 'po'], scope: ['imp', 'po'] }),
  ], characters);
  assert.ok(errors.some((e) => e.includes('outside its scope')));
  assert.ok(errors.some((e) => e.includes('never splits')));
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

test('falls back to a direct question when nothing separates the pool', () => {
  const two = characters.slice(0, 2);
  const game = new Game({ characters: two, questions: [], rng: seeded(1) });
  assert.ok(game.current.fallback);
  assert.ok(game.current.plain && game.current.dinniman && game.current.voice);
  game.answer(false);
  assert.ok(game.done);
  assert.notEqual(game.result.id, [...game.history[0].question.yesSet][0]);
});
