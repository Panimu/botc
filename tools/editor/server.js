// Local question editor: browse, review and edit questions, traits and share
// quotes. Run `npm run editor`, then open http://localhost:8010.
//
// It listens on 127.0.0.1 only and writes straight into data/: question files
// (data/questions/*.json), traits (data/traits/*.json, after which it reruns
// scripts/build-characters.js) and data/share-quotes.json. Every question save
// is checked with the validator's own rules first, so it can't write a question
// the validator would reject. Never published: build-site.js copies an allow-list.
import http from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuestions, plainWording } from '../../scripts/validate.js';
import { BANNED_PATTERNS } from '../../scripts/build-site.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.PORT) || 8010;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const TRAIT_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const KEY_ORDER = ['id', 'plain', 'styled', 'voice', 'yes', 'scope', 'options'];

const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const writeJson = (path, value) => writeFile(join(root, path), JSON.stringify(value, null, 2) + '\n');
const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd: root, maxBuffer: 1 << 24 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, output: `${stdout}${stderr}` }));
});
const git = (args) => new Promise((resolve) => {
  execFile('git', args, { cwd: root, maxBuffer: 1 << 26 }, (error, stdout) => resolve(error ? null : stdout));
});
const fail = (status, ...errors) => ({ status, body: { errors } });
const ok = (extra = {}) => ({ status: 200, body: { ok: true, ...extra } });

async function loadTraits() {
  const traits = {};
  const files = (await readdir(join(root, 'data/traits'))).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    for (const [name, trait] of Object.entries(await readJson(`data/traits/${file}`))) traits[name] = { file, ...trait };
  }
  return { traits, traitFiles: files };
}

// Just the data the validator needs (no git lookups), for fast checks.
async function loadQuestions() {
  const characters = await readJson('data/characters.json');
  const files = await readJson('data/questions/index.json');
  const questions = (await Promise.all(files.map((file) => readJson(`data/questions/${file}`)))).flat();
  return { characters, files, questions };
}

async function loadAll() {
  const characters = await readJson('data/characters.json');
  const files = await readJson('data/questions/index.json');
  const questionFiles = [];
  for (const file of files) {
    const questions = await readJson(`data/questions/${file}`);
    // Flag questions that differ from the last commit, for reviewing recent edits.
    const committed = await git(['show', `HEAD:data/questions/${file}`]);
    const before = new Map(committed ? JSON.parse(committed).map((q) => [q.id, JSON.stringify(q)]) : []);
    questionFiles.push({
      file,
      questions: questions.map((q) => ({ ...q, _changed: before.get(q.id) !== JSON.stringify(q), _warnings: plainWording(q.plain ?? '').warnings })),
    });
  }
  const { traits, traitFiles } = await loadTraits();
  const quotes = await readJson('data/share-quotes.json');
  const voices = [...new Set([...questionFiles.flatMap((f) => f.questions.map((q) => q.voice)), ...Object.values(quotes).map((q) => q.voice)])].filter(Boolean).sort();
  return { characters, files, questionFiles, traits, traitFiles, quotes, voices };
}

const strip = ({ _changed, _warnings, ...question }) => question;

// Keep the key order the files use.
function ordered(question) {
  const out = {};
  for (const key of KEY_ORDER) if (question[key] !== undefined) out[key] = question[key];
  for (const [key, value] of Object.entries(question)) if (!(key in out)) out[key] = value;
  return out;
}

// Errors the validator would report for this question if it replaced the saved one
// (or joined the set, for a new question).
async function errorsFor(draft) {
  const { characters, questions } = await loadQuestions();
  const others = questions.filter((q) => q.id !== draft.id);
  const label = `Question ${draft.id}`;
  return checkQuestions([...others, draft], characters).filter((e) => e.startsWith(`${label}:`) || e.startsWith(`${label} `));
}

async function checkFile(file) {
  const files = await readJson('data/questions/index.json');
  return files.includes(file);
}

async function saveQuestion({ file, question, create = false }) {
  if (!(await checkFile(file))) return fail(400, `Unknown file ${file}`);
  const draft = ordered(strip(question));
  if (!ID_PATTERN.test(draft.id ?? '')) return fail(422, 'The id must be lower-case words joined by hyphens, like "tfc-quiet-nights".');
  const { questions: all } = await loadQuestions();
  const exists = all.some((q) => q.id === draft.id);
  if (create && exists) return fail(422, `The id ${draft.id} is already taken.`);
  const errors = await errorsFor(draft);
  if (errors.length) return fail(422, ...errors);
  const questions = await readJson(`data/questions/${file}`);
  const index = questions.findIndex((q) => q.id === draft.id);
  if (create) questions.push(draft);
  else if (index < 0) return fail(404, `${draft.id} isn't in ${file}`);
  else questions[index] = draft;
  await writeJson(`data/questions/${file}`, questions);
  return ok();
}

async function renameQuestion({ file, id, newId }) {
  if (!(await checkFile(file))) return fail(400, `Unknown file ${file}`);
  if (!ID_PATTERN.test(newId ?? '')) return fail(422, 'The id must be lower-case words joined by hyphens, like "tfc-quiet-nights".');
  const { questions: all } = await loadQuestions();
  if (all.some((q) => q.id === newId)) return fail(422, `The id ${newId} is already taken.`);
  const questions = await readJson(`data/questions/${file}`);
  const question = questions.find((q) => q.id === id);
  if (!question) return fail(404, `${id} isn't in ${file}`);
  question.id = newId;
  await writeJson(`data/questions/${file}`, questions);
  return ok();
}

async function deleteQuestion({ file, id }) {
  if (!(await checkFile(file))) return fail(400, `Unknown file ${file}`);
  const questions = await readJson(`data/questions/${file}`);
  const kept = questions.filter((q) => q.id !== id);
  if (kept.length === questions.length) return fail(404, `${id} isn't in ${file}`);
  await writeJson(`data/questions/${file}`, kept);
  return ok();
}

async function rebuildAndCheck() {
  const rebuilt = await run(['scripts/build-characters.js']);
  if (rebuilt.code) return { failed: `build-characters.js failed:\n${rebuilt.output}` };
  const { characters, questions } = await loadQuestions();
  return { errors: checkQuestions(questions, characters) };
}

// Create or update one trait: { name, file, definition, yes, no (array, or null for a non-subjective trait), create }.
async function saveTrait({ name, file, definition, yes, no = null, create = false }) {
  const { traits, traitFiles } = await loadTraits();
  const characters = await readJson('data/characters.json');
  const ids = new Set(characters.map((c) => c.id));
  if (!TRAIT_PATTERN.test(name ?? '')) return fail(422, 'A trait name is camelCase letters and digits, like "killsByDay".');
  if (create) {
    if (traits[name]) return fail(422, `There's already a trait called ${name}.`);
    if (characters.some((c) => name in c)) return fail(422, `${name} is already a character field.`);
    if (name.endsWith('Clear')) return fail(422, 'Names ending in "Clear" are made by the build for subjective traits.');
    if (!traitFiles.includes(file)) return fail(422, `Unknown trait file ${file}`);
  } else if (!traits[name]) {
    return fail(404, `Unknown trait ${name}`);
  }
  if (!definition?.trim()) return fail(422, 'A trait needs a definition: what counts, and what doesn\'t.');
  const unknown = [...yes, ...(no ?? [])].filter((id) => !ids.has(id));
  if (unknown.length) return fail(422, `Unknown characters: ${unknown.join(', ')}`);
  const both = (no ?? []).filter((id) => yes.includes(id));
  if (both.length) return fail(422, `On both the yes and no lists: ${both.join(', ')}`);
  const target = create ? file : traits[name].file;
  const all = await readJson(`data/traits/${target}`);
  // Keep existing order where possible so diffs stay small.
  const keepOrder = (before, after) => [...(before ?? []).filter((id) => after.includes(id)), ...after.filter((id) => !(before ?? []).includes(id))];
  const trait = { definition: definition.trim(), yes: keepOrder(all[name]?.yes, yes) };
  if (no) trait.no = keepOrder(all[name]?.no, no);
  all[name] = trait;
  await writeJson(`data/traits/${target}`, all);
  const result = await rebuildAndCheck();
  if (result.failed) return fail(500, result.failed);
  return ok({ errors: result.errors });
}

// Remove a trait, only if no question uses it (or its …Clear field).
async function deleteTrait({ name }) {
  const { traits } = await loadTraits();
  if (!traits[name]) return fail(404, `Unknown trait ${name}`);
  const { questions } = await loadQuestions();
  const users = questions.filter((q) => {
    const text = JSON.stringify([q.yes, q.scope ?? null]);
    return text.includes(`"${name}"`) || text.includes(`"${name}Clear"`);
  }).map((q) => q.id);
  if (users.length) return fail(422, `Still used by: ${users.join(', ')}`);
  const all = await readJson(`data/traits/${traits[name].file}`);
  delete all[name];
  await writeJson(`data/traits/${traits[name].file}`, all);
  const result = await rebuildAndCheck();
  if (result.failed) return fail(500, result.failed);
  return ok({ errors: result.errors });
}

// Set one character's membership across many traits ({ trait: 'yes' | 'no' | 'unclear' }),
// and optionally its share quote ({ quote, voice }).
async function saveCharacter({ id, traits: wanted = {}, quote = null }) {
  const characters = await readJson('data/characters.json');
  if (!characters.some((c) => c.id === id)) return fail(404, `Unknown character ${id}`);
  if (quote) {
    if (!quote.quote?.trim() || !quote.voice?.trim()) return fail(422, 'A share quote needs both the quote and its voice.');
    if (quote.quote.includes('—')) return fail(422, 'The quote contains an em dash; use a comma, colon or full stop.');
    // Quotes are published; voices are not.
    if (BANNED_PATTERNS.some((re) => re.test(quote.quote))) return fail(422, 'The quote names one of the people or characters that must never reach the site.');
  }
  const { traits } = await loadTraits();
  const byFile = new Map();
  for (const [name, state] of Object.entries(wanted)) {
    const trait = traits[name];
    if (!trait) return fail(404, `Unknown trait ${name}`);
    if (!byFile.has(trait.file)) byFile.set(trait.file, await readJson(`data/traits/${trait.file}`));
    const entry = byFile.get(trait.file)[name];
    entry.yes = entry.yes.filter((x) => x !== id);
    if (Array.isArray(entry.no)) entry.no = entry.no.filter((x) => x !== id);
    // For a trait without a "no" list, "no" (or "unclear") just means off the yes list.
    if (state === 'yes') entry.yes.push(id);
    if (state === 'no' && Array.isArray(entry.no)) entry.no.push(id);
  }
  for (const [file, content] of byFile) await writeJson(`data/traits/${file}`, content);
  if (quote) {
    const quotes = await readJson('data/share-quotes.json');
    quotes[id] = { voice: quote.voice.trim(), quote: quote.quote.trim() };
    await writeJson('data/share-quotes.json', quotes);
  }
  if (!byFile.size) return ok({ errors: [] });
  const result = await rebuildAndCheck();
  if (result.failed) return fail(500, result.failed);
  return ok({ errors: result.errors });
}

async function body(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

function send(res, status, value, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(value) : value);
}

async function serveFile(res, base, path) {
  const full = normalize(join(base, path));
  if (!full.startsWith(normalize(base + sep))) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    send(res, 200, await readFile(full), TYPES[extname(full)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

// The review list: questions to look at, each with its reasons. Kept in
// .cache/review-queue.json (not committed) so agents and scripts can add to it:
// { items: [{ id, reasons: [{ text, source, added }], reviewed, resolution }] }
const QUEUE = '.cache/review-queue.json';
async function readQueue() {
  try {
    const queue = JSON.parse(await readFile(join(root, QUEUE), 'utf8'));
    return { items: Array.isArray(queue.items) ? queue.items : [] };
  } catch {
    return { items: [] };
  }
}
async function writeQueue({ items }) {
  if (!Array.isArray(items)) return fail(400, 'Expected { items: [...] }');
  const clean = items.filter((i) => typeof i?.id === 'string').map((i) => ({
    id: i.id,
    reasons: (Array.isArray(i.reasons) ? i.reasons : []).filter((r) => r?.text).map((r) => ({ text: String(r.text), source: String(r.source ?? ''), added: String(r.added ?? '') })),
    reviewed: Boolean(i.reviewed),
    resolution: String(i.resolution ?? ''),
  }));
  await mkdir(join(root, '.cache'), { recursive: true });
  await writeFile(join(root, QUEUE), JSON.stringify({ items: clean }, null, 2) + '\n');
  return ok();
}

const ACTIONS = {
  '/api/review': writeQueue,
  '/api/save': saveQuestion,
  '/api/rename': renameQuestion,
  '/api/delete': deleteQuestion,
  '/api/trait': saveTrait,
  '/api/trait/delete': deleteTrait,
  '/api/character': saveCharacter,
};

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && pathname === '/api/data') return send(res, 200, await loadAll());
    if (req.method === 'GET' && pathname === '/api/review') return send(res, 200, await readQueue());
    if (req.method === 'POST' && pathname === '/api/check') {
      const draft = strip((await body(req)).question ?? {});
      return send(res, 200, { errors: await errorsFor(draft), warnings: plainWording(draft.plain ?? '').warnings });
    }
    if (req.method === 'POST' && ACTIONS[pathname]) {
      const { status, body: result } = await ACTIONS[pathname](await body(req));
      return send(res, status, result);
    }
    if (req.method === 'POST' && pathname === '/api/validate') return send(res, 200, await run(['scripts/validate.js', '--verbose']));
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
    // Token art and the engine come from the repo; the editor's own files from here.
    if (pathname.startsWith('/resources/characters/') || pathname === '/js/engine.js') return serveFile(res, root, pathname.slice(1));
    return serveFile(res, here, pathname === '/' ? 'index.html' : pathname.slice(1));
  } catch (error) {
    send(res, 500, { errors: [String(error?.stack ?? error)] });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Question editor: http://localhost:${PORT}  (Ctrl+C to stop)`));
