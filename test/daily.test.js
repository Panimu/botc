import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyGame, schedule, dailyCharacterId, dayNumber, replay, streaks, seededRng,
  EXCLUDED_FILES, GUESS_THRESHOLD, MAX_WRONG_GUESSES, NO_REPEAT_DAYS, UNLIKELY_DAYS, OFFER_COUNT, LAUNCH_DATE,
  par, encodeResults, decodeResults, archiveDate, pastHunts, FREEZE_EVERY,
} from '../js/daily.js';
import { loadData } from '../scripts/load.js';

const { characters, questionFiles } = await loadData();
const questions = questionFiles.filter((f) => !EXCLUDED_FILES.includes(f.file)).flatMap((f) => f.questions);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const TWO_YEARS = addDays(LAUNCH_DATE, 730);

test('the seeded generator is deterministic', () => {
  const a = seededRng('x'), b = seededRng('x'), c = seededRng('y');
  const seq = (r) => [r(), r(), r()].join();
  assert.equal(seq(a), seq(b));
  assert.notEqual(seq(seededRng('x')), seq(c));
});

test('the character for a date is always the same', () => {
  const date = addDays(LAUNCH_DATE, 40);
  assert.equal(dailyCharacterId(date, characters), dailyCharacterId(date, [...characters].reverse()));
  assert.equal(dayNumber(LAUNCH_DATE), 0);
});

test('no character repeats on consecutive days, and repeats within the next fortnight are rare', () => {
  const days = schedule(TWO_YEARS, characters);
  let nearRepeats = 0;
  days.forEach((id, day) => {
    for (let back = 1; back <= NO_REPEAT_DAYS; back++) assert.notEqual(days[day - back], id, `day ${day} repeats day ${day - back}`);
    for (let back = NO_REPEAT_DAYS + 1; back <= NO_REPEAT_DAYS + UNLIKELY_DAYS; back++) if (days[day - back] === id) nearRepeats++;
  });
  // With uniform picks a repeat in a 14-day window would happen ~9% of days; weighting cuts that well down but not to zero.
  assert.ok(nearRepeats > 0, 'near repeats should still be possible');
  assert.ok(nearRepeats / days.length < 0.04, `near repeats too common: ${nearRepeats}/${days.length}`);
});

test('the same choices give the same offers; the same character gets different questions on different days', () => {
  const date = addDays(LAUNCH_DATE, 10);
  const one = new DailyGame({ characters, questions, date });
  const two = new DailyGame({ characters, questions, date });
  assert.deepEqual(one.offers.map((q) => q.id), two.offers.map((q) => q.id));
  assert.equal(one.offers.length, OFFER_COUNT);
  one.ask(one.offers[0].id); two.ask(two.offers[0].id);
  assert.deepEqual(one.offers.map((q) => q.id), two.offers.map((q) => q.id));

  const days = schedule(TWO_YEARS, characters);
  const firstRepeat = days.findIndex((id, i) => days.indexOf(id) < i);
  const earlier = days.indexOf(days[firstRepeat]);
  const offers = (day) => new DailyGame({ characters, questions, date: addDays(LAUNCH_DATE, day) }).offers.map((q) => q.id).join();
  assert.notEqual(offers(earlier), offers(firstRepeat));
});

test('guessing only opens once 15 or fewer remain, and three wrong guesses lose', () => {
  const game = new DailyGame({ characters, questions, date: addDays(LAUNCH_DATE, 3) });
  assert.equal(game.canGuess, false);
  assert.throws(() => game.guess(game.pool[0]));
  while (game.status === 'playing' && game.pool.length > GUESS_THRESHOLD) game.ask(game.offers[0].id);
  if (game.status !== 'playing') return; // solved by questions alone
  assert.ok(game.canGuess);
  const wrong = game.pool.filter((id) => id !== game.target).slice(0, MAX_WRONG_GUESSES);
  if (wrong.length < MAX_WRONG_GUESSES) return;
  wrong.forEach((id) => game.guess(id));
  assert.equal(game.status, 'lost');
});

test('answers are truthful and the target is never eliminated', () => {
  for (let day = 0; day < 30; day++) {
    const game = new DailyGame({ characters, questions, date: addDays(LAUNCH_DATE, day) });
    while (game.status === 'playing' && game.offers.length) {
      const q = game.offers[day % game.offers.length];
      assert.equal(game.ask(q.id), q.yesSet.has(game.target));
      assert.ok(game.pool.includes(game.target));
    }
  }
});

test('replaying saved actions restores the same state', () => {
  const date = addDays(LAUNCH_DATE, 5);
  const game = new DailyGame({ characters, questions, date });
  const actions = [];
  while (game.status === 'playing' && !game.canGuess) { const id = game.offers.at(-1).id; actions.push({ ask: id }); game.ask(id); }
  const again = replay(new DailyGame({ characters, questions, date }), actions);
  assert.deepEqual(again.pool, game.pool);
  assert.equal(again.score, game.score);
});

test('streaks count consecutive won days', () => {
  const results = { '2026-10-04': { won: true }, '2026-10-05': { won: true }, '2026-10-06': { won: false }, '2026-10-07': { won: true }, '2026-10-08': { won: true }, '2026-10-09': { won: true } };
  const s = streaks(results, '2026-10-09');
  assert.equal(s.current, 3);
  assert.equal(s.best, 3);
  assert.equal(s.played, 6);
  assert.equal(streaks(results, '2026-10-10').current, 3, 'today not played yet keeps yesterday\'s streak');
  assert.equal(streaks(results, '2026-10-11').current, 0, 'a missed day breaks it');
});

test("from the start date, yesterday's character begins eliminated", async () => {
  const { PRE_ELIMINATE_FROM } = await import('../js/daily.js');
  const before = new DailyGame({ characters, questions, date: LAUNCH_DATE });
  assert.equal(before.yesterday, null);
  assert.equal(before.pool.length, characters.length);
  const date = addDays(PRE_ELIMINATE_FROM, 3);
  const game = new DailyGame({ characters, questions, date });
  const days = schedule(date, characters);
  assert.equal(game.yesterday, days.at(-2));
  assert.ok(!game.pool.includes(game.yesterday));
  assert.ok(game.pool.includes(game.target));
  assert.equal(game.pool.length, characters.length - 1);
});

test('par is deterministic and a real score', () => {
  const date = addDays(LAUNCH_DATE, 4);
  const a = par(date, characters, questions);
  assert.equal(a, par(date, characters, questions));
  assert.ok(Number.isInteger(a) && a >= 1 && a < 40, `par ${a}`);
});

test('a missed day spends a streak freeze earned by winning; losses still break streaks', () => {
  const results = {};
  for (let i = 0; i < FREEZE_EVERY; i++) results[addDays('2026-11-01', i)] = { won: true, score: 7 };
  const missed = addDays('2026-11-01', FREEZE_EVERY);
  const after = addDays('2026-11-01', FREEZE_EVERY + 1);
  results[after] = { won: true, score: 6 };
  const s = streaks(results, after);
  assert.deepEqual(s.frozen, [missed]);
  assert.equal(s.current, FREEZE_EVERY + 1);
  assert.equal(s.freezes, 0);
  results[addDays('2026-11-01', FREEZE_EVERY + 2)] = { won: false, score: null };
  assert.equal(streaks(results, addDays('2026-11-01', FREEZE_EVERY + 2)).current, 0);
});

test('restore codes round-trip results', () => {
  const results = { [LAUNCH_DATE]: { won: true, score: 8 }, [addDays(LAUNCH_DATE, 2)]: { won: false, score: null } };
  assert.deepEqual(decodeResults(encodeResults(results)), results);
  assert.throws(() => decodeResults('not-a-code'));
});

test('archive dates must be real past hunts', () => {
  const today = addDays(LAUNCH_DATE, 5);
  assert.equal(archiveDate(addDays(LAUNCH_DATE, 1), today), addDays(LAUNCH_DATE, 1));
  assert.equal(archiveDate(today, today), null, 'today is not the archive');
  assert.equal(archiveDate('2020-01-01', today), null);
  assert.equal(archiveDate('2026-02-30', today), null);
  assert.equal(pastHunts(today).length, 5);
  assert.equal(pastHunts(today)[0].number, 5);
});
