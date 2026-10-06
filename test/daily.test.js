import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyGame, schedule, dailyCharacterId, dayNumber, replay, streaks, seededRng,
  EXCLUDED_FILES, GUESS_THRESHOLD, MAX_WRONG_GUESSES, NO_REPEAT_DAYS, UNLIKELY_DAYS, OFFER_COUNT, LAUNCH_DATE,
  par, parRun, encodeResults, decodeResults, cleanResults, archiveDate, pastHunts,
  OVER_PAR_QUESTIONS, GUESS_BUDGET, HUNT_MIN_SIDE, tier, streakLine, TIERS,
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

test('restore codes round-trip results', () => {
  const results = { [LAUNCH_DATE]: { won: true, score: 8 }, [addDays(LAUNCH_DATE, 2)]: { won: false, score: null } };
  assert.deepEqual(decodeResults(encodeResults(results), addDays(LAUNCH_DATE, 2)), results);
  assert.throws(() => decodeResults('not-a-code', LAUNCH_DATE));
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

test('restore codes with any bad entry are rejected whole', () => {
  const today = addDays(LAUNCH_DATE, 5);
  const code = (r) => btoa(JSON.stringify({ v: 1, r })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  assert.deepEqual(decodeResults(code([[0, 7], [5, -1]]), today), { [LAUNCH_DATE]: { won: true, score: 7 }, [today]: { won: false, score: null } });
  for (const [what, r] of [
    ['a day far in the future (the reported payload)', [[0, 7], [3000000, 7]]],
    ['tomorrow', [[6, 7]]],
    ['a negative day', [[-1, 7]]],
    ['a fractional day', [[1.5, 7]]],
    ['a string day', [['1', 7]]],
    ['a zero score', [[1, 0]]],
    ['an impossible score', [[1, 999]]],
    ['a fractional score', [[1, 6.5]]],
    ['a negative score other than -1', [[1, -2]]],
    ['a missing score', [[1]]],
    ['a non-array entry', [{ day: 1, score: 7 }]],
    ['a repeated day', [[1, 7], [1, 8]]],
  ]) assert.throws(() => decodeResults(code(r), today), undefined, what);
});

test('stored results are repaired: malformed entries go, valid ones stay', () => {
  const stored = {
    [LAUNCH_DATE]: { won: true, score: 7 },
    '+010240-06': { won: true, score: 7 },
    '2026-02-30': { won: true, score: 7 },
    '2026-01-01': { won: true, score: 7 },
    [addDays(LAUNCH_DATE, 1)]: { won: true, score: 0 },
    [addDays(LAUNCH_DATE, 2)]: { won: false, score: null },
    [addDays(LAUNCH_DATE, 3)]: { won: 'yes', score: 4 },
    [addDays(LAUNCH_DATE, 9)]: { won: true, score: 5 },
  };
  const today = addDays(LAUNCH_DATE, 3);
  assert.deepEqual(cleanResults(stored, today), { [LAUNCH_DATE]: { won: true, score: 7 }, [addDays(LAUNCH_DATE, 2)]: { won: false, score: null } });
  assert.ok(addDays(LAUNCH_DATE, 9) in cleanResults(stored, null), 'future dates stay when today is not known for certain');
  assert.deepEqual(cleanResults([1, 2], today), {});
  assert.deepEqual(cleanResults('junk', today), {});
  // The repaired history renders: streaks no longer throws.
  assert.doesNotThrow(() => streaks(cleanResults(stored, today), today));
  assert.throws(() => streaks(stored, today), RangeError, 'the unrepaired history is what used to crash');
});

test("par's path runs from the full town to one character and ends on par's score", () => {
  for (let day = 0; day < 10; day++) {
    const date = addDays(LAUNCH_DATE, day);
    const { score, path } = parRun(date, characters, questions);
    if (score == null) continue;
    assert.equal(score, par(date, characters, questions));
    assert.equal(path[0].points, 0);
    assert.equal(path[0].left, new DailyGame({ characters, questions, date }).pool.length);
    assert.equal(path.at(-1).left, 1);
    assert.equal(path.at(-1).points, score);
    path.slice(1).forEach((s, i) => {
      assert.ok(s.points >= path[i].points, 'points never go down');
      assert.ok(s.left < path[i].left, 'every move narrows the town');
    });
  }
});

test('a missed day or a loss ends a streak; every recorded hunt counts, with or without a par', () => {
  const results = {
    '2026-10-05': { won: true, score: 9 },
    '2026-10-06': { won: true, score: 8, par: 7 },
    '2026-10-07': { won: true, score: 7, par: 9 },
  };
  assert.equal(streaks(results, '2026-10-07').current, 3, 'the pre-budget hunt carries over');
  assert.equal(streaks(results, '2026-10-08').current, 3, 'today not played yet keeps the streak');
  assert.equal(streaks(results, '2026-10-09').current, 0, 'a missed day ends it, with no freeze to spend');
  results['2026-10-08'] = { won: false, score: null, par: 12 };
  assert.equal(streaks(results, '2026-10-08').current, 0, 'a loss ends it');
  assert.equal(streaks(results, '2026-10-08').best, 3);
  assert.ok(!('freezes' in streaks(results, '2026-10-08')));
});

test('budgets: par + 2 questions and 3 guesses, overflow into questions, lost only when no move is left', () => {
  const date = addDays(LAUNCH_DATE, 2);
  const p = par(date, characters, questions);
  const full = new DailyGame({ characters, questions, date, par: p });
  assert.equal(full.questionsLeft, p + OVER_PAR_QUESTIONS);
  assert.equal(full.guessesLeft, GUESS_BUDGET);
  // A deliberately tiny budget (as if par were 1) runs the questions out early.
  const game = new DailyGame({ characters, questions, date, par: 1 });
  while (game.status === 'playing' && game.offers.length) game.ask(game.offers[0].id);
  assert.equal(game.status, 'playing');
  assert.equal(game.questionsLeft, 0, 'offers stop when the questions run out');
  assert.equal(game.offers.length, 0);
  assert.ok(game.pool.length > GUESS_BUDGET + 1);
  assert.ok(game.canGuess, 'guessing opens once no question can be asked');
  for (const id of game.pool.filter((c) => c !== game.target)) {
    if (game.status !== 'playing') break;
    game.guess(id);
  }
  // With no questions left only the 3 guesses were affordable, and all were wrong.
  assert.equal(game.status, 'lost');
  assert.equal(game.wrongGuesses.length, GUESS_BUDGET);
  assert.ok(game.pool.length > 1);
});

test('a guess with no guess budget left spends a question instead', () => {
  const date = addDays(LAUNCH_DATE, 4);
  const p = par(date, characters, questions);
  const game = new DailyGame({ characters, questions, date, par: p });
  while (game.status === 'playing' && !(game.pool.length <= GUESS_THRESHOLD)) game.ask(game.offers[0].id);
  if (game.status !== 'playing') return;
  const wrong = game.pool.filter((id) => id !== game.target);
  if (wrong.length < GUESS_BUDGET + 1 || game.questionsLeft < 1) return;
  for (let i = 0; i < GUESS_BUDGET; i++) game.guess(wrong[i]);
  assert.equal(game.guessesLeft, 0);
  const before = game.questionsLeft;
  if (game.status !== 'playing') return;
  game.guess(wrong[GUESS_BUDGET]);
  assert.equal(game.questionsLeft, before - 1);
  assert.equal(game.score, game.history.length + game.wrongGuesses.length, 'scoring is unchanged');
});

test('random play never wins above par + 5, and only loses with no legal move left', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let wins = 0;
  let losses = 0;
  for (let day = 0; day < 12; day++) {
    const date = addDays(LAUNCH_DATE, day);
    const p = par(date, characters, questions);
    for (let player = 0; player < 25; player++) {
      const game = new DailyGame({ characters, questions, date, par: p });
      while (game.status === 'playing') {
        const canAsk = game.offers.length > 0;
        if (game.canGuess && (!canAsk || rnd() < 0.35)) game.guess(game.pool[Math.floor(rnd() * game.pool.length)]);
        else if (canAsk) game.ask(game.offers[Math.floor(rnd() * game.offers.length)].id);
        else assert.fail('a playing game must have a legal move');
      }
      if (game.status === 'won') {
        wins++;
        assert.ok(game.score <= p + OVER_PAR_QUESTIONS + GUESS_BUDGET, 'won in ' + game.score + ' with par ' + p);
      } else {
        losses++;
        assert.ok(game.pool.length > 1);
        assert.equal(game.offers.length, 0);
        assert.equal(game.canGuess, false);
      }
    }
  }
  assert.ok(wins > 0 && losses > 0, 'both outcomes happen: ' + wins + ' wins, ' + losses + ' losses');
});

test('without a par the old rules apply: unlimited questions, three wrong guesses lose', () => {
  const game = new DailyGame({ characters, questions, date: addDays(LAUNCH_DATE, 3) });
  assert.equal(game.budgeted, false);
  assert.equal(game.questionsLeft, Infinity);
});

test('tiers and the ten-day streak line', () => {
  assert.equal(tier({ won: true, score: 6, par: 7 }), 'under');
  assert.equal(tier({ won: true, score: 7, par: 7 }), 'par');
  assert.equal(tier({ won: true, score: 8, par: 7 }), 'plusOne');
  assert.equal(tier({ won: true, score: 11, par: 7 }), 'scraped');
  assert.equal(tier({ won: false, score: null, par: 7 }), 'lost');
  assert.equal(tier({ won: true, score: 9 }), 'untiered');
  assert.equal(tier(undefined), 'missed');
  const results = {
    '2026-10-10': { won: true, score: 7, par: 7 },
    '2026-10-12': { won: true, score: 5, par: 7 },
    '2026-10-13': { won: false, score: null, par: 6 },
  };
  const line = streakLine(results, '2026-10-13');
  assert.equal(line.length, 10);
  assert.deepEqual(line.slice(-4), ['par', 'missed', 'under', 'lost']);
  assert.ok(line.slice(0, 6).every((key) => key === 'before'), 'days before the first hunt');
  assert.equal(streakLine(results, '2026-10-14').at(-1), 'before', 'today unplayed is not missed yet');
  assert.equal(line.map((key) => TIERS[key][0]).join(''), '······🟩⬜🟦🟥');
});

test('restore codes keep the par, and old version 1 codes still restore', () => {
  const today = addDays(LAUNCH_DATE, 3);
  const results = { [LAUNCH_DATE]: { won: true, score: 9 }, [addDays(LAUNCH_DATE, 1)]: { won: true, score: 6, par: 7 }, [addDays(LAUNCH_DATE, 2)]: { won: false, score: null, par: 8 } };
  assert.deepEqual(decodeResults(encodeResults(results), today), results);
  const v1 = btoa(JSON.stringify({ v: 1, r: [[0, 7]] })).replaceAll('=', '');
  assert.deepEqual(decodeResults(v1, today), { [LAUNCH_DATE]: { won: true, score: 7 } });
  const badPar = btoa(JSON.stringify({ v: 2, r: [[0, 7, 0]] })).replaceAll('=', '');
  assert.throws(() => decodeResults(badPar, today));
  assert.deepEqual(cleanResults({ [LAUNCH_DATE]: { won: true, score: 7, par: 'x' } }, today), {});
});

test('hunt offers: above 15 left, no side under 7 when avoidable; at 15 or fewer, no single-character splits when avoidable', () => {
  let bigChecked = 0;
  let smallChecked = 0;
  for (let day = 0; day < 12; day++) {
    const date = addDays(LAUNCH_DATE, day);
    const game = new DailyGame({ characters, questions, date });
    while (game.status === 'playing' && game.offers.length) {
      const n = game.pool.length;
      const sides = (q) => { const yes = game.pool.filter((id) => q.yesSet.has(id)).length; return Math.min(yes, n - yes); };
      const all = game.questions.filter((q) => !game.history.some((h) => h.question === q)
        && (!q.scopeSet || game.pool.every((id) => q.scopeSet.has(id))) && sides(q) > 0);
      const minSide = n > GUESS_THRESHOLD ? HUNT_MIN_SIDE : 2;
      const good = all.filter((q) => sides(q) >= minSide).length;
      const goodOffered = game.offers.filter((q) => sides(q) >= minSide).length;
      // As many offers meet the rule as possible.
      assert.equal(goodOffered, Math.min(good, game.offers.length), `day ${day}, ${n} left`);
      if (n > GUESS_THRESHOLD) bigChecked++; else smallChecked++;
      game.ask(game.offers[day % game.offers.length].id);
    }
  }
  assert.ok(bigChecked > 10 && smallChecked > 5);
});

test('hunt offers: above 15 left they spread across even and bolder splits, and the order is shuffled', () => {
  let evenFirst = 0;
  let spreads = 0;
  let turns = 0;
  for (let day = 0; day < 20; day++) {
    const game = new DailyGame({ characters, questions, date: addDays(LAUNCH_DATE, day) });
    const n = game.pool.length;
    const share = (q) => { const yes = game.pool.filter((id) => q.yesSet.has(id)).length; return Math.max(yes, n - yes) / n; };
    const shares = game.offers.map(share);
    turns++;
    if (shares.indexOf(Math.min(...shares)) === 0) evenFirst++;
    if (Math.max(...shares) - Math.min(...shares) >= 0.1) spreads++;
    // Same seed, same offers in the same order.
    assert.deepEqual(new DailyGame({ characters, questions, date: addDays(LAUNCH_DATE, day) }).offers.map((q) => q.id), game.offers.map((q) => q.id));
  }
  assert.ok(spreads >= turns * 0.7, `offers usually span 50/50 to 70/30: ${spreads} of ${turns}`);
  assert.ok(evenFirst < turns * 0.7, `the most even offer isn't always shown first: ${evenFirst} of ${turns}`);
});
