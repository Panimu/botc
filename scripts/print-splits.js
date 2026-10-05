// Prints each question with its two sides resolved to character names, for
// reviewing splits by eye.
//
//   node scripts/print-splits.js minions.json [demons.json ...]
//   node scripts/print-splits.js --id xd-broad-daylight
import { loadData } from './load.js';
import { prepare } from '../js/engine.js';

const args = process.argv.slice(2);
const { characters, questionFiles } = await loadData();
const name = new Map(characters.map((c) => [c.id, c.name]));
const ids = args.includes('--id') ? new Set(args.slice(args.indexOf('--id') + 1)) : null;
const files = args.filter((a) => a.endsWith('.json'));

for (const { file, questions } of questionFiles) {
  if (!ids && !files.includes(file)) continue;
  for (const q of questions) {
    if (ids && !ids.has(q.id)) continue;
    const { yesSet, scopeSet } = prepare(q, characters);
    const pool = scopeSet ? [...scopeSet] : characters.map((c) => c.id);
    const no = pool.filter((id) => !yesSet.has(id));
    const list = (set) => [...set].map((id) => name.get(id)).sort().join(', ');
    console.log(`${q.id}  (${file})`);
    console.log(`  Q: ${q.plain}`);
    console.log(`  yes selector: ${JSON.stringify(q.yes)}${q.scope ? `   scope selector: ${JSON.stringify(q.scope)}` : ''}`);
    console.log(`  YES (${yesSet.size}): ${list(yesSet)}`);
    console.log(scopeSet ? `  NO within scope (${no.length}): ${list(no)}` : `  NO: the other ${no.length} characters`);
    console.log('');
  }
}
