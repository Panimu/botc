// Checks data/*.json for integrity and that every character has token art,
// then reports separability coverage: how many pairs of characters at least one
// question tells apart. Unseparated characters can still be reached, but the
// game has to fall back to asking about their abilities directly.
// Usage: node scripts/validate.js [--verbose]
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { artPath } from '../js/art.js';
import { resolveYes } from '../js/engine.js';

const TEAMS = new Set(['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled', 'loric']);
const exists = (path) => existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));

export function validate(characters, questions) {
  const errors = [];
  const ids = new Set();

  for (const c of characters) {
    if (!c.id || !c.name || !c.summary) errors.push(`Character missing id/name/summary: ${JSON.stringify(c)}`);
    if (ids.has(c.id)) errors.push(`Duplicate character id: ${c.id}`);
    if (!TEAMS.has(c.team)) errors.push(`Character ${c.id} has unknown team: ${c.team}`);
    if (!exists(artPath(c))) errors.push(`Character ${c.id} has no art at ${artPath(c)}`);
    ids.add(c.id);
  }

  const questionIds = new Set();
  const sets = [];
  for (const q of questions) {
    if (!q.id || !q.text || (!Array.isArray(q.yes) && typeof q.match !== 'object')) {
      errors.push(`Question needs id, text and either yes or match: ${JSON.stringify(q)}`);
      continue;
    }
    if (questionIds.has(q.id)) errors.push(`Duplicate question id: ${q.id}`);
    questionIds.add(q.id);
    const yes = resolveYes(q, characters);
    for (const id of yes) if (!ids.has(id)) errors.push(`Question ${q.id} names unknown character: ${id}`);
    if (new Set(yes).size !== yes.length) errors.push(`Question ${q.id} lists a character twice`);
    if (yes.length === 0 || yes.length >= ids.size) errors.push(`Question ${q.id} never splits the full pool (${yes.length} on the yes side)`);
    if (q.options && (!Array.isArray(q.options) || q.options.length !== 2)) errors.push(`Question ${q.id} options must be [yesLabel, noLabel]`);
    sets.push(new Set(yes));
  }

  // Characters with identical answers to every question can't be told apart.
  const groups = new Map();
  for (const id of ids) {
    const key = sets.map((s) => (s.has(id) ? 1 : 0)).join('');
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const lookalikes = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
  const totalPairs = (ids.size * (ids.size - 1)) / 2;
  const unseparatedPairs = lookalikes.reduce((n, g) => n + (g.length * (g.length - 1)) / 2, 0);

  return { errors, lookalikes, totalPairs, unseparatedPairs };
}

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const characters = await loadJson('data/characters.json');
  const questions = await loadJson('data/questions.json');
  const { errors, lookalikes, totalPairs, unseparatedPairs } = validate(characters, questions);
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`\n${errors.length} problem(s) found.`);
    process.exit(1);
  }
  const separated = totalPairs - unseparatedPairs;
  console.log(`OK: ${characters.length} characters, ${questions.length} questions.`);
  console.log(`Separable pairs: ${separated} of ${totalPairs} (${((100 * separated) / totalPairs).toFixed(1)}%).`);
  if (lookalikes.length) {
    const largest = lookalikes[0].length;
    console.log(`${lookalikes.length} groups of characters answer every question identically (largest: ${largest}).`);
    const shown = process.argv.includes('--verbose') ? lookalikes : lookalikes.slice(0, 5);
    for (const g of shown) console.log(`  ${g.join(', ')}`);
    if (shown.length < lookalikes.length) console.log('  … run with --verbose for all groups');
  }
}
