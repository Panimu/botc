// Pure game logic, shared by the browser (js/app.js) and the Node tests.
// Strict elimination: every answer removes the characters on the losing side.

// Ids on a question's "yes" side: either listed in `yes`, or every character
// whose fields satisfy `match` ({ field: value } or { field: [allowed values] }).
export function resolveYes(question, characters) {
  if (question.yes) return question.yes;
  const rules = Object.entries(question.match ?? {});
  return characters
    .filter((c) => rules.every(([field, want]) => (Array.isArray(want) ? want.includes(c[field]) : c[field] === want)))
    .map((c) => c.id);
}

// True when the question puts at least one pooled character on each side.
export function splits(question, pool) {
  let yes = 0;
  for (const id of pool) if (question.yesSet.has(id)) yes++;
  return yes > 0 && yes < pool.length;
}

export class Game {
  constructor({ characters, questions, rng = Math.random }) {
    this.characters = characters;
    this.questions = questions.map((q) => {
      const yes = resolveYes(q, characters);
      return { ...q, yes, yesSet: new Set(yes) };
    });
    this.rng = rng;
    this.restart();
  }

  restart() {
    this.pool = this.characters.map((c) => c.id);
    this.history = [];
    this.current = this.#pick();
  }

  get done() {
    return this.pool.length <= 1;
  }

  get result() {
    return this.done ? this.characters.find((c) => c.id === this.pool[0]) ?? null : null;
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
    if (this.done) return null;
    const eligible = this.eligible();
    if (eligible.length) return eligible[Math.floor(this.rng() * eligible.length)];
    return this.#fallback();
  }

  // Only reached when the data can't separate the remaining characters
  // (scripts/validate.js reports those pairs). Asks about one character directly.
  #fallback() {
    const id = this.pool[Math.floor(this.rng() * this.pool.length)];
    const character = this.characters.find((c) => c.id === id);
    return {
      id: `fallback-${id}`,
      text: `Does this sound like you? “${character.summary}”`,
      yes: [id],
      yesSet: new Set([id]),
      fallback: true,
    };
  }
}
