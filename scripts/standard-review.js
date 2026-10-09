// Candidates for a Standard Review of a day's hunt (tomorrow's, by default):
// the three opening offers, then the questions near the top of the tree, with how
// often players meet them, the answer for that day's character, and their quality.
// Picking the three extra questions (dubious, or still at the default quality) is
// a judgement call; this lists the evidence.
//
//   node scripts/standard-review.js [YYYY-MM-DD]
import { DailyGame, EXCLUDED_FILES, parRun, utcDate } from '../js/daily.js';
import { RATING_DEFAULT } from './validate.js';
import { loadData } from './load.js';

const date = process.argv[2] ?? utcDate(new Date(Date.now() + 86400000));
const { characters, questionFiles } = await loadData();
const questions = questionFiles.filter((f) => !EXCLUDED_FILES.includes(f.file)).flatMap((f) => f.questions);
const par = parRun(date, characters, questions).score;
const fresh = () => new DailyGame({ characters, questions, date, par });
const first = fresh();
const target = first.targetCharacter;
const byId = new Map(first.questions.map((q) => [q.id, q]));
const answer = (id) => (byId.get(id).yesSet.has(target.id) ? 'yes' : 'no');
const describe = (id) => {
  const q = byId.get(id);
  return `${id} [${answer(id)}] quality ${q.quality ?? RATING_DEFAULT}${(q.quality ?? RATING_DEFAULT) === RATING_DEFAULT ? ' (default)' : ''}, complexity ${q.complexity}: ${q.plain}`;
};

console.log(`${date}: answer ${target.name} (${target.team}), par ${par}`);
console.log(`  ${target.summary}\n`);
console.log('Opening offers:');
for (const q of first.offers) console.log(`  ${describe(q.id)}`);

// Near the top of the tree: the offers on the second and third screens, weighted by
// how many random players reach them.
let seed = 17;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const PLAYERS = 1000;
const seen = new Map();
for (let p = 0; p < PLAYERS; p++) {
  const game = fresh();
  for (let screen = 0; screen < 3 && game.status === 'playing' && game.offers.length; screen++) {
    if (screen > 0) for (const q of game.offers) seen.set(q.id, (seen.get(q.id) ?? new Set()).add(p));
    game.ask(game.offers[Math.floor(rand() * game.offers.length)].id);
  }
}
const opening = new Set(first.offers.map((q) => q.id));
console.log(`\nNear the top (screens 2 and 3; share of ${PLAYERS} random players who see it):`);
for (const [id, players] of [...seen].filter(([id]) => !opening.has(id)).sort((a, b) => b[1].size - a[1].size).slice(0, 15)) {
  console.log(`  ${String(Math.round((100 * players.size) / PLAYERS)).padStart(3)}%  ${describe(id)}`);
}
