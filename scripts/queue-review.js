// Adds findings to the editor's review list (.cache/review-queue.json), merging
// with what's there: a question already listed gets the new reason added.
//
//   node scripts/queue-review.js <findings.json> [more.json ...] [--source "rules check"]
//
// Each findings file is a JSON array of { id, reason, confidence? }.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadData } from './load.js';

const args = process.argv.slice(2);
const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'agent';
const files = args.filter((a, i) => a.endsWith('.json') && args[i - 1] !== '--source');
const queuePath = new URL('../.cache/review-queue.json', import.meta.url);

const { questions } = await loadData();
const known = new Set(questions.map((q) => q.id));
let queue = { items: [] };
try { queue = JSON.parse(await readFile(queuePath, 'utf8')); } catch {}
const added = new Date().toISOString().slice(0, 10);
let newItems = 0;
let newReasons = 0;
const unknown = [];

for (const file of files) {
  for (const finding of JSON.parse(await readFile(file, 'utf8'))) {
    if (!known.has(finding.id)) { unknown.push(finding.id); continue; }
    const text = finding.confidence ? `[${finding.confidence}] ${finding.reason}` : finding.reason;
    let item = queue.items.find((i) => i.id === finding.id);
    if (!item) {
      item = { id: finding.id, reasons: [], reviewed: false, resolution: '' };
      queue.items.push(item);
      newItems++;
    }
    if (!item.reasons.some((r) => r.text === text)) {
      item.reasons.push({ text, source, added });
      item.reviewed = false;
      newReasons++;
    }
  }
}

await mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
await writeFile(queuePath, JSON.stringify(queue, null, 2) + '\n');
console.log(`Review list: ${newItems} new question(s), ${newReasons} new reason(s), ${queue.items.length} in total.`);
if (unknown.length) console.log(`Skipped unknown ids: ${unknown.join(', ')}`);
