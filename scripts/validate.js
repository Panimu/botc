// Checks data/*.json for integrity, that every character has token art, and
// that every pair of characters can be told apart by at least one question.
// Pairwise separability guarantees the game never needs its fallback question
// under strict elimination.
// Usage: node scripts/validate.js
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { artPath } from '../js/art.js';

const TEAMS = new Set(['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled']);

export function validate(characters, questions) {
  const errors = [];
  const ids = new Set();

  for (const c of characters) {
    if (!c.id || !c.name || !c.summary) errors.push(`Character missing id/name/summary: ${JSON.stringify(c)}`);
    if (ids.has(c.id)) errors.push(`Duplicate character id: ${c.id}`);
    if (!TEAMS.has(c.team)) errors.push(`Character ${c.id} has unknown team: ${c.team}`);
    if (!existsSync(fileURLToPath(new URL(`../${artPath(c)}`, import.meta.url)))) errors.push(`Character ${c.id} has no art at ${artPath(c)}`);
    ids.add(c.id);
  }

  const questionIds = new Set();
  for (const q of questions) {
    if (!q.id || !q.text || !Array.isArray(q.yes)) {
      errors.push(`Question missing id/text/yes: ${JSON.stringify(q)}`);
      continue;
    }
    if (questionIds.has(q.id)) errors.push(`Duplicate question id: ${q.id}`);
    questionIds.add(q.id);
    for (const id of q.yes) if (!ids.has(id)) errors.push(`Question ${q.id} names unknown character: ${id}`);
    if (new Set(q.yes).size !== q.yes.length) errors.push(`Question ${q.id} lists a character twice`);
    if (q.yes.length === 0 || q.yes.length >= ids.size) errors.push(`Question ${q.id} never splits the full pool`);
    if (q.options && (!Array.isArray(q.options) || q.options.length !== 2)) errors.push(`Question ${q.id} options must be [yesLabel, noLabel]`);
  }

  // A pair is separated when some question has exactly one of them on its yes side.
  const sets = questions.filter((q) => Array.isArray(q.yes)).map((q) => new Set(q.yes));
  const list = [...ids];
  const unseparated = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (!sets.some((s) => s.has(a) !== s.has(b))) unseparated.push([a, b]);
    }
  }
  for (const [a, b] of unseparated) errors.push(`No question separates ${a} from ${b}`);

  return { errors, unseparated };
}

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const characters = await loadJson('data/characters.json');
  const questions = await loadJson('data/questions.json');
  const { errors } = validate(characters, questions);
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`\n${errors.length} problem(s) found.`);
    process.exit(1);
  }
  console.log(`OK: ${characters.length} characters, ${questions.length} questions, every pair separable.`);
}
