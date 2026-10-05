// The daily hunt: everyone gets the same hidden character and, for the same
// choices, the same question offers on a given date. Pure logic, no DOM, so it
// runs in the browser (js/daily-app.js) and in the Node tests.
import { prepare, weightedOptions, drawWeighted, CIRCLE_TARGET } from './engine.js?v=dev';

export const LAUNCH_DATE = '2026-10-05';
export const OFFER_COUNT = 3;
export const MAX_WRONG_GUESSES = 3;
// Guessing opens once the town circle is seated.
export const GUESS_THRESHOLD = CIRCLE_TARGET.max;
// Never the same character two days running; much less likely if used in the
// fortnight before that; otherwise every character is equally likely.
export const NO_REPEAT_DAYS = 1;
export const UNLIKELY_DAYS = 14;
export const UNLIKELY_WEIGHT = 0.15;
// Yesterday's character can't be today's answer, so from this date the hunt
// starts with them already eliminated. (Earlier hunts are left as they were.)
export const PRE_ELIMINATE_FROM = '2026-10-06';
// Rules-based questions only: personality and token-art questions are too
// subjective for a puzzle everyone plays against the same answer.
export const EXCLUDED_FILES = ['psychology.json', 'icons.json'];

// cyrb53-style string hash feeding mulberry32: a small seeded PRNG.
export function seededRng(seed) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  let a = h1 >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const DAY_MS = 86400000;
const toUtc = (date) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

// The UTC date as YYYY-MM-DD: the daily hunt's day, the same for everyone.
export function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// The player's local date as YYYY-MM-DD.
export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Days since launch: puzzle #1 is launch day. Dates before launch count as launch day.
export function dayNumber(date) {
  return Math.max(0, Math.round((toUtc(date) - toUtc(LAUNCH_DATE)) / DAY_MS));
}

// The hidden character for every day from launch to `date`, replayed from the
// start so the no-repeat rules hold. Characters are ordered by id so the
// schedule doesn't depend on file order.
const scheduleCache = new Map();
export function schedule(date, characters) {
  const ids = characters.map((c) => c.id).sort();
  const key = ids.join(',');
  const days = dayNumber(date) + 1;
  let known = scheduleCache.get(key) ?? [];
  const lastUsed = new Map();
  known.forEach((id, day) => lastUsed.set(id, day));
  for (let day = known.length; day < days; day++) {
    const rng = seededRng(`clocktower-daily|character|${fromUtc(toUtc(LAUNCH_DATE) + day * DAY_MS)}`);
    const options = ids.map((id) => {
      const ago = lastUsed.has(id) ? day - lastUsed.get(id) : Infinity;
      const weight = ago <= NO_REPEAT_DAYS ? 0 : ago <= NO_REPEAT_DAYS + UNLIKELY_DAYS ? UNLIKELY_WEIGHT : 1;
      return [id, weight];
    }).filter(([, w]) => w > 0);
    const [id] = drawWeighted(options, rng);
    known = [...known, id];
    lastUsed.set(id, day);
  }
  scheduleCache.set(key, known);
  return known.slice(0, days);
}

export function dailyCharacterId(date, characters) {
  return schedule(date, characters).at(-1);
}

export class DailyGame {
  constructor({ characters, questions, date }) {
    this.characters = characters;
    this.questions = questions.map((q) => prepare(q, characters));
    this.date = date;
    this.number = dayNumber(date) + 1;
    const days = schedule(date, characters);
    this.target = days.at(-1);
    this.yesterday = date >= PRE_ELIMINATE_FROM && days.length > 1 ? days.at(-2) : null;
    this.pool = characters.map((c) => c.id).filter((id) => id !== this.yesterday);
    this.history = []; // { question, answer, poolBefore }
    this.wrongGuesses = [];
    this.status = 'playing'; // 'won' | 'lost'
    this.refreshOffers();
  }

  get targetCharacter() {
    return this.characters.find((c) => c.id === this.target);
  }

  get score() {
    return this.history.length + this.wrongGuesses.length;
  }

  // Offers depend only on the date and the questions asked so far, so players
  // who make the same choices see the same offers.
  refreshOffers() {
    if (this.status !== 'playing' || this.pool.length <= 1) { this.offers = []; return; }
    const asked = new Set(this.history.map((h) => h.question.id));
    const rng = seededRng(`clocktower-daily|offers|${this.date}|${[...asked].join(',')}`);
    this.offers = drawWeighted(weightedOptions(this.questions, this.pool, asked), rng, OFFER_COUNT);
  }

  // Guessing opens once the circle is seated, or if no question can split the rest.
  get canGuess() {
    return this.status === 'playing' && (this.pool.length <= GUESS_THRESHOLD || this.offers.length === 0);
  }

  ask(questionId) {
    const question = this.offers.find((q) => q.id === questionId);
    if (this.status !== 'playing' || !question) throw new Error(`Question ${questionId} isn't on offer`);
    const answer = question.yesSet.has(this.target);
    this.history.push({ question, answer, poolBefore: this.pool });
    this.pool = this.pool.filter((id) => question.yesSet.has(id) === answer);
    if (this.pool.length === 1) this.status = 'won';
    this.refreshOffers();
    return answer;
  }

  guess(characterId) {
    if (!this.canGuess || !this.pool.includes(characterId)) throw new Error(`Can't guess ${characterId} now`);
    if (characterId === this.target) {
      this.status = 'won';
    } else {
      this.wrongGuesses.push(characterId);
      this.pool = this.pool.filter((id) => id !== characterId);
      if (this.wrongGuesses.length >= MAX_WRONG_GUESSES) this.status = 'lost';
      else if (this.pool.length === 1) this.status = 'won';
    }
    this.refreshOffers();
    return characterId === this.target;
  }
}

// Rebuilds a game from saved actions ({ ask: id } or { guess: id }, in order);
// the game is deterministic, so replaying restores the exact state.
export function replay(game, actions) {
  for (const action of actions) {
    if (game.status !== 'playing') break;
    if (action.ask) game.ask(action.ask);
    else if (action.guess) game.guess(action.guess);
  }
  return game;
}

// Streak bookkeeping over { date: { won, score } } results.
export function streaks(results, today) {
  const won = (date) => results[date]?.won === true;
  const prev = (date) => fromUtc(toUtc(date) - DAY_MS);
  let current = 0;
  let day = won(today) || results[today] ? today : prev(today);
  while (won(day)) { current++; day = prev(day); }
  let best = 0;
  let run = 0;
  const dates = Object.keys(results).sort();
  dates.forEach((date, i) => {
    run = won(date) && (i > 0 && dates[i - 1] === prev(date) && won(dates[i - 1])) ? run + 1 : won(date) ? 1 : 0;
    best = Math.max(best, run);
  });
  const played = dates.length;
  const wins = dates.filter(won).length;
  return { current, best, played, wins };
}
