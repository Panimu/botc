// The authoring ratings on questions (quality, complexity: 1 low to 10 high).
//
//   node scripts/ratings.js dump complexity            tab-separated: id, current, words, file, plain
//   node scripts/ratings.js set complexity <ratings.json> [--dry-run]
//                                                       ratings.json is { "<question id>": 1-10, ... }
//   node scripts/ratings.js report complexity           how the ratings are spread
import { readFile, writeFile } from 'node:fs/promises';
import { RATINGS } from './validate.js';

const [command, field, file] = process.argv.slice(2);
const dryRun = process.argv.includes('--dry-run');
if (!['dump', 'set', 'report'].includes(command) || !RATINGS.includes(field)) {
  console.error(`Usage: node scripts/ratings.js dump|set|report ${RATINGS.join('|')} [ratings.json] [--dry-run]`);
  process.exit(1);
}

const dir = new URL('../data/questions/', import.meta.url);
const files = JSON.parse(await readFile(new URL('index.json', dir), 'utf8'));
const sets = [];
for (const name of files) sets.push({ name, questions: JSON.parse(await readFile(new URL(name, dir), 'utf8')) });
const all = sets.flatMap(({ name, questions }) => questions.map((q) => ({ ...q, file: name })));
const words = (text) => text.trim().split(/\s+/).length;

function report(values) {
  const counts = Array.from({ length: 10 }, (_, i) => values.filter((v) => v === i + 1).length);
  const width = Math.max(...counts);
  for (let i = 0; i < 10; i++) console.log(`${String(i + 1).padStart(2)}  ${String(counts[i]).padStart(4)}  ${'#'.repeat(Math.round((counts[i] / width) * 50))}`);
  const unused = counts.flatMap((n, i) => (n ? [] : [i + 1]));
  console.log(unused.length ? `Unused: ${unused.join(', ')}` : 'Every value from 1 to 10 is used.');
  console.log(`Mean ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)} over ${values.length} questions.`);
}

if (command === 'dump') {
  for (const q of all) console.log([q.id, q[field] ?? '', words(q.plain), q.file, q.plain].join('\t'));
} else if (command === 'report') {
  report(all.map((q) => q[field]));
} else {
  const ratings = JSON.parse(await readFile(file, 'utf8'));
  const known = new Set(all.map((q) => q.id));
  const errors = [
    ...Object.keys(ratings).filter((id) => !known.has(id)).map((id) => `unknown question ${id}`),
    ...Object.entries(ratings).filter(([, v]) => !Number.isInteger(v) || v < 1 || v > 10).map(([id, v]) => `${id}: ${JSON.stringify(v)} is not a whole number from 1 to 10`),
  ];
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const missing = all.filter((q) => !(q.id in ratings)).map((q) => q.id);
  if (missing.length) console.log(`Not in the file, left as they are (${missing.length}): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', …' : ''}`);
  let changed = 0;
  for (const set of sets) for (const q of set.questions) if (q.id in ratings && q[field] !== ratings[q.id]) { q[field] = ratings[q.id]; changed++; }
  report(all.map((q) => ratings[q.id] ?? q[field]));
  if (dryRun) console.log(`Dry run: ${changed} questions would change.`);
  else {
    for (const { name, questions } of sets) await writeFile(new URL(name, dir), JSON.stringify(questions, null, 2) + '\n');
    console.log(`Set ${field} on ${changed} questions.`);
  }
}
