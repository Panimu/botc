// The daily hunt: everyone gets the same hidden character and, for the same
// choices, the same question offers on a given date. Pure logic, no DOM, so it
// runs in the browser (js/daily-app.js) and in the Node tests.
import { prepare, drawWeighted, splitWeight, CIRCLE_TARGET } from './engine.js?v=dev';

export const LAUNCH_DATE = '2026-10-05';
export const OFFER_COUNT = 3;
// How the hunt picks its offers. While more than GUESS_THRESHOLD remain,
// questions that would leave fewer than HUNT_MIN_SIDE on either side are set
// aside (used only to fill a slot nothing else can), and the three offers aim
// at these splits (bigger side's share of the pool), nearer being likelier.
// At GUESS_THRESHOLD or fewer, questions that would single out one character
// are set aside the same way, and even splits are favoured. Two offers never
// split the remaining characters the same way (either way round), even if the
// questions differ. Offers are shown shuffled, so position gives nothing away.
export const HUNT_MIN_SIDE = 7;
export const SPLIT_TARGETS = [0.5, 0.6, 0.7];
const TARGET_SPREAD = 0.05;
// Budgets, when a game is given the day's par: par + OVER_PAR_QUESTIONS questions
// and GUESS_BUDGET guesses. A guess with no guess budget left spends a question
// instead, so a winning score is at most par + 5. A hunt is lost when no legal
// move remains with more than one character left.
export const OVER_PAR_QUESTIONS = 2;
export const GUESS_BUDGET = 3;
// The old rules, used without a par (the par solver itself, and hunts saved
// before budgets): unlimited questions, and three wrong guesses lose.
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
  // par: the day's par, which sets the budgets. Leave it out (or null) for the
  // old unbudgeted rules. Callers compute it separately: par() itself builds
  // a DailyGame, so the constructor can't.
  constructor({ characters, questions, date, par = null }) {
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
    this.par = par;
    this.questionBudget = par == null ? Infinity : par + OVER_PAR_QUESTIONS;
    this.guessBudget = par == null ? Infinity : GUESS_BUDGET;
    this.guessesMade = 0;
    this.status = 'playing'; // 'won' | 'lost'
    this.refreshOffers();
  }

  get targetCharacter() {
    return this.characters.find((c) => c.id === this.target);
  }

  get score() {
    return this.history.length + this.wrongGuesses.length;
  }

  get budgeted() {
    return this.par != null;
  }

  get guessesLeft() {
    return Math.max(0, this.guessBudget - this.guessesMade);
  }

  // Guesses beyond the guess budget come out of the question budget.
  get questionsLeft() {
    return this.questionBudget - this.history.length - Math.max(0, this.guessesMade - this.guessBudget);
  }

  // Offers depend only on the date and the questions asked so far (in order),
  // so every player who makes the same choices sees the same offers: one tree
  // of options for everyone. None once the questions run out.
  refreshOffers() {
    if (this.status !== 'playing' || this.pool.length <= 1 || this.questionsLeft <= 0) { this.offers = []; return; }
    const asked = new Set(this.history.map((h) => h.question.id));
    const rng = seededRng(`clocktower-daily|offers|${this.date}|${[...asked].join(',')}`);
    const n = this.pool.length;

    // Every question that applies to the whole pool and splits it.
    const candidates = [];
    for (const question of this.questions) {
      if (asked.has(question.id)) continue;
      if (question.scopeSet && this.pool.some((id) => !question.scopeSet.has(id))) continue;
      const yesIds = this.pool.filter((id) => question.yesSet.has(id));
      const yes = yesIds.length;
      if (yes === 0 || yes === n) continue;
      // How it splits this pool, the same whichever side is "yes".
      const noIds = this.pool.filter((id) => !question.yesSet.has(id));
      const split = yesIds[0] < noIds[0] ? yesIds.join() : noIds.join();
      candidates.push({ question, small: Math.min(yes, n - yes), large: Math.max(yes, n - yes), split });
    }

    const picked = [];
    const shown = new Set(); // splits already on offer
    const fresh = (c) => !picked.includes(c) && !shown.has(c.split);
    const draw = (pool, weightOf) => {
      const [choice] = drawWeighted(pool.filter(fresh).map((c) => [c, weightOf(c)]), rng);
      if (choice) { picked.push(choice); shown.add(choice.split); }
      return choice;
    };
    // The set-aside questions only fill a slot nothing else can, most even first.
    const even = (c) => splitWeight(c.small, n);
    const big = n > GUESS_THRESHOLD;
    const preferred = candidates.filter((c) => c.small >= (big ? HUNT_MIN_SIDE : 2));
    const available = () => preferred.some(fresh);
    if (big) {
      for (const target of SPLIT_TARGETS) {
        if (available()) draw(preferred, (c) => Math.exp(-(((c.large / n - target) / TARGET_SPREAD) ** 2)) + 1e-9);
        else draw(candidates, even);
      }
    } else {
      while (picked.length < OFFER_COUNT && draw(available() ? preferred : candidates, even));
    }

    // Shuffle (seeded) so the 50/50 isn't always first.
    const offers = picked.map((c) => c.question);
    for (let i = offers.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [offers[i], offers[j]] = [offers[j], offers[i]];
    }
    this.offers = offers;
  }

  // Guessing opens once the circle is seated, or when no question can be asked
  // (none splits the rest, or the questions ran out), while a guess can be paid for.
  get canGuess() {
    return this.status === 'playing' && (this.pool.length <= GUESS_THRESHOLD || this.offers.length === 0)
      && (this.guessesLeft > 0 || this.questionsLeft > 0);
  }

  // Lost when no legal move remains and the character isn't yet found.
  checkStuck() {
    if (this.status === 'playing' && this.pool.length > 1 && !this.offers.length && !this.canGuess) this.status = 'lost';
  }

  ask(questionId) {
    const question = this.offers.find((q) => q.id === questionId);
    if (this.status !== 'playing' || !question) throw new Error(`Question ${questionId} isn't on offer`);
    const answer = question.yesSet.has(this.target);
    this.history.push({ question, answer, poolBefore: this.pool });
    this.pool = this.pool.filter((id) => question.yesSet.has(id) === answer);
    if (this.pool.length === 1) this.status = 'won';
    this.refreshOffers();
    this.checkStuck();
    return answer;
  }

  guess(characterId) {
    if (!this.canGuess || !this.pool.includes(characterId)) throw new Error(`Can't guess ${characterId} now`);
    this.guessesMade++;
    if (characterId === this.target) {
      this.status = 'won';
    } else {
      this.wrongGuesses.push(characterId);
      this.pool = this.pool.filter((id) => id !== characterId);
      if (!this.budgeted && this.wrongGuesses.length >= MAX_WRONG_GUESSES) this.status = 'lost';
      else if (this.pool.length === 1) this.status = 'won';
    }
    this.refreshOffers();
    this.checkStuck();
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

// Streak bookkeeping over { date: { won, score, par } } results, walking day by
// day. Every recorded hunt counts, from before budgets too, so existing streaks
// carried over. A loss or a missed day (any day but today) ends a streak; there
// are no freezes.
export function streaks(results, today) {
  const dates = Object.keys(results).sort();
  const wins = dates.filter((d) => results[d]?.won === true).length;
  const summary = { current: 0, best: 0, played: dates.length, wins };
  if (!dates.length) return summary;
  let streak = 0;
  for (let day = dates[0]; day <= today; day = fromUtc(toUtc(day) + DAY_MS)) {
    const result = results[day];
    if (result?.won) streak++;
    else if (result || day !== today) streak = 0;
    summary.best = Math.max(summary.best, streak);
  }
  summary.current = streak;
  return summary;
}

// One square per day for the streak line, against the par stored with the result.
export const TIERS = {
  under: ['🟦', 'under par'],
  par: ['🟩', 'par'],
  plusOne: ['🟨', 'par +1'],
  scraped: ['🟧', 'par +2 to +5'],
  lost: ['🟥', 'lost'],
  missed: ['⬜', 'missed'],
  untiered: ['▫️', 'played before budgets'],
  before: ['·', 'not yet playing'],
};

export function tier(result) {
  if (!result) return 'missed';
  if (result.par == null) return 'untiered';
  if (!result.won) return 'lost';
  const over = result.score - result.par;
  return over < 0 ? 'under' : over === 0 ? 'par' : over === 1 ? 'plusOne' : 'scraped';
}

// The last `days` days ending today, oldest first, as tier keys. Days before
// the player's first hunt are 'before'; today unplayed is 'before' too, since
// it can't be missed yet.
export function streakLine(results, today, days = 10) {
  const first = Object.keys(results).sort()[0] ?? today;
  const line = [];
  for (let back = days - 1; back >= 0; back--) {
    const day = fromUtc(toUtc(today) - back * DAY_MS);
    if (day < first || day < LAUNCH_DATE || (day === today && !results[day])) line.push('before');
    else line.push(tier(results[day]));
  }
  return line;
}

// Par: the score a sensible player gets today without knowing the answer. It
// always asks the offered question that splits the remaining town most evenly,
// and guesses (alphabetically) only when no question can split what's left.
export function par(date, characters, questions) {
  return parRun(date, characters, questions).score;
}

// Par's whole run: its score (null if it loses) and, for the chart, the
// characters left and points spent after each of its moves.
export function parRun(date, characters, questions) {
  const game = new DailyGame({ characters, questions, date });
  const names = new Map(characters.map((c) => [c.id, c.name]));
  const path = [{ left: game.pool.length, points: 0 }];
  while (game.status === 'playing') {
    if (game.offers.length) {
      const even = (q) => Math.abs(game.pool.filter((id) => q.yesSet.has(id)).length - game.pool.length / 2);
      game.ask([...game.offers].sort((a, b) => even(a) - even(b))[0].id);
    } else {
      game.guess([...game.pool].sort((a, b) => names.get(a).localeCompare(names.get(b)))[0]);
    }
    path.push({ left: game.status === 'won' ? 1 : game.pool.length, points: game.score });
  }
  return { score: game.status === 'won' ? game.score : null, path };
}

// More points than any hunt can take (at most 155 questions plus 3 wrong guesses).
export const MAX_SCORE = 200;
const validScore = (score) => Number.isInteger(score) && score >= 1 && score <= MAX_SCORE;
// A real YYYY-MM-DD on or after launch.
const isHuntDate = (date) => typeof date === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)
  && date >= LAUNCH_DATE && fromUtc(toUtc(date)) === date;
// par is present on hunts played with budgets.
const validResult = (r) => Boolean(r) && typeof r === 'object'
  && (r.won === true ? validScore(r.score) : r.won === false && r.score === null)
  && (r.par === undefined || validScore(r.par));

// Stored results with anything malformed dropped: bad date keys, dates before
// launch, impossible scores. Dates after `today` are dropped too when today is
// known for certain (pass null when only the device clock is available, which
// may run behind the host's).
export function cleanResults(results, today = null) {
  if (!results || typeof results !== 'object' || Array.isArray(results)) return {};
  return Object.fromEntries(Object.entries(results)
    .filter(([date, r]) => isHuntDate(date) && (today == null || date <= today) && validResult(r)));
}

// Restore codes carry results between devices: [day number, score or -1 for a
// loss, par if the hunt had budgets] entries, JSON then base64url. Version 1
// codes (no par) still restore. Not tamper-proof; it's a daily puzzle.
export function encodeResults(results) {
  const entries = Object.entries(results).sort().map(([date, r]) => {
    const entry = [dayNumber(date), r.won ? r.score : -1];
    if (r.par != null) entry.push(r.par);
    return entry;
  });
  const json = JSON.stringify({ v: 2, r: entries });
  return btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// Throws unless every entry is a whole day from launch to `today` (once each)
// with a possible score or -1 (and, in version 2, an optional possible par), so
// a bad code is rejected whole and never saved.
export function decodeResults(code, today) {
  const json = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const data = JSON.parse(json);
  if ((data?.v !== 1 && data?.v !== 2) || !Array.isArray(data.r)) throw new Error('Unrecognised restore code');
  const lastDay = dayNumber(today);
  const sizes = data.v === 1 ? [2] : [2, 3];
  const results = {};
  for (const entry of data.r) {
    const [day, score, par] = Array.isArray(entry) && sizes.includes(entry.length) ? entry : [];
    if (!Number.isInteger(day) || day < 0 || day > lastDay) throw new Error(`Restore code has an invalid day: ${day}`);
    if (score !== -1 && !validScore(score)) throw new Error(`Restore code has an invalid score: ${score}`);
    if (entry.length === 3 && !validScore(par)) throw new Error(`Restore code has an invalid par: ${par}`);
    const date = fromUtc(toUtc(LAUNCH_DATE) + day * DAY_MS);
    if (date in results) throw new Error(`Restore code lists day ${day} twice`);
    results[date] = score === -1 ? { won: false, score: null } : { won: true, score };
    if (entry.length === 3) results[date].par = par;
  }
  return results;
}

// Every hunt from launch up to (not including) today, newest first, for the archive.
export function pastHunts(today) {
  const list = [];
  for (let day = dayNumber(today) - 1; day >= 0; day--) list.push({ number: day + 1, date: fromUtc(toUtc(LAUNCH_DATE) + day * DAY_MS) });
  return list;
}

// A valid archive date: a real YYYY-MM-DD from launch up to yesterday.
export function archiveDate(requested, today) {
  return isHuntDate(requested) && requested < today ? requested : null;
}
