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

// True when the question applies to the pool and puts someone on each side.
export function splits(question, pool) {
  let yes = 0;
  for (const id of pool) {
    if (question.scopeSet && !question.scopeSet.has(id)) return false;
    if (question.yesSet.has(id)) yes++;
  }
  return yes > 0 && yes < pool.length;
}

export class Game {
  constructor({ characters, questions, rng = Math.random }) {
    this.characters = characters;
    this.questions = questions.map((q) => prepare(q, characters));
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
    const eligible = this.eligible();
    return eligible.length ? eligible[Math.floor(this.rng() * eligible.length)] : null;
  }
}
