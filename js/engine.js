// Pure game logic, shared by the browser (js/app.js), the validator and the tests.
// Strict elimination: every answer removes the characters on the losing side.

// A selector is either a list of character ids or a match object:
// { field: value } or { field: [allowed values] }, all fields must hold.
export function select(selector, characters) {
  const rules = Object.entries(Array.isArray(selector) ? { id: selector } : selector);
  return characters
    .filter((c) => rules.every(([field, want]) => (Array.isArray(want) ? want.includes(c[field]) : c[field] === want)))
    .map((c) => c.id);
}

// Resolves a question's selectors. `scope` (optional) limits the question to a
// sub-pool: it's only asked when every remaining character is inside the scope,
// so its wording may take that context for granted. Without one, the "no" side
// is every other character.
export function prepare(question, characters) {
  const scope = question.scope ? new Set(select(question.scope, characters)) : null;
  const yes = select(question.yes, characters).filter((id) => !scope || scope.has(id));
  return { ...question, yesSet: new Set(yes), scopeSet: scope };
}

// How many pooled characters are on the yes side, or -1 if the pool isn't
// entirely inside the question's scope.
function yesCount(question, pool) {
  let yes = 0;
  for (const id of pool) {
    if (question.scopeSet && !question.scopeSet.has(id)) return -1;
    if (question.yesSet.has(id)) yes++;
  }
  return yes;
}

// True when the question applies to the pool and puts someone on each side.
export function splits(question, pool) {
  const yes = yesCount(question, pool);
  return yes > 0 && yes < pool.length;
}

// Questions are picked at random, weighted towards even splits of the current
// pool: weight = entropy(yes share) ^ exponent + floor. Narrow questions stay
// possible, and become natural late on, when a 1-in-3 split is an even one.
export const SPLIT_WEIGHTING = { exponent: 1.5, floor: 0.02 };

// The town circle seats the survivors once `max` or fewer remain (js/circle.js).
// While more remain, questions that could drop the pool below `min` are
// down-weighted and ones that could land it in min..max are favoured, so the
// circle usually seats 7-15 rather than two or three.
export const CIRCLE_TARGET = { min: 7, max: 15, penalty: 0.05, boost: 2 };

export function circleFactor(yes, poolSize, { min, max, penalty, boost } = CIRCLE_TARGET) {
  if (poolSize <= max) return 1;
  const sides = [yes, poolSize - yes];
  if (sides.some((n) => n < min)) return penalty;
  if (sides.some((n) => n <= max)) return boost;
  return 1;
}

export function splitWeight(yes, poolSize, { exponent, floor } = SPLIT_WEIGHTING) {
  const p = yes / poolSize;
  const entropy = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  return entropy ** exponent + floor;
}

export class Game {
  // minSide: ignore questions with fewer than this many characters on either
  // side of their full split (1 keeps everything; 2 drops one-vs-the-rest).
  constructor({ characters, questions, rng = Math.random, weighting = SPLIT_WEIGHTING, circleTarget = CIRCLE_TARGET, minSide = 1 }) {
    this.characters = characters;
    this.weighting = weighting;
    this.circleTarget = circleTarget;
    this.questions = questions
      .map((q) => prepare(q, characters))
      .filter((q) => {
        const scopeSize = q.scopeSet?.size ?? characters.length;
        return q.yesSet.size >= minSide && scopeSize - q.yesSet.size >= minSide;
      });
    this.rng = rng;
    this.restart();
  }

  restart() {
    this.pool = this.characters.map((c) => c.id);
    this.history = [];
    this.current = this.#pick();
  }

  // Over when one character is left, or when no question can split the rest.
  get done() {
    return this.current === null;
  }

  // The remaining characters once the game is over: usually one, several when
  // no question can tell them apart (scripts/validate.js reports how often).
  get results() {
    return this.done ? this.characters.filter((c) => this.pool.includes(c.id)) : [];
  }

  // Unasked questions that would still narrow the pool.
  eligible() {
    const asked = new Set(this.history.map((h) => h.question.id));
    return this.questions.filter((q) => !asked.has(q.id) && splits(q, this.pool));
  }

  answer(yes) {
    if (this.done) throw new Error('Game is over');
    const question = this.current;
    this.history.push({ question, answer: yes, pool: this.pool });
    this.pool = this.pool.filter((id) => question.yesSet.has(id) === yes);
    this.current = this.#pick();
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.pool = last.pool;
    this.current = last.question;
    return true;
  }

  #pick() {
    if (this.pool.length <= 1) return null;
    const asked = new Set(this.history.map((h) => h.question.id));
    const options = [];
    let total = 0;
    for (const q of this.questions) {
      if (asked.has(q.id)) continue;
      const yes = yesCount(q, this.pool);
      if (yes <= 0 || yes >= this.pool.length) continue;
      const weight = (this.weighting ? splitWeight(yes, this.pool.length, this.weighting) : 1)
        * (this.circleTarget ? circleFactor(yes, this.pool.length, this.circleTarget) : 1);
      options.push([q, weight]);
      total += weight;
    }
    let r = this.rng() * total;
    for (const [q, weight] of options) if ((r -= weight) < 0) return q;
    return options.at(-1)?.[0] ?? null;
  }
}
