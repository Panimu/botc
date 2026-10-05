// Local question editor: browse, review and edit questions, their wording and
// their split. Run `npm run editor`, then open http://localhost:8010.
//
// It listens on 127.0.0.1 only and writes straight into data/: question files
// (data/questions/*.json) and traits (data/traits/*.json, after which it reruns
// scripts/build-characters.js). Every question save is checked with the
// validator's own rules first, so it can't write a question the validator
// would reject. Never published: build-site.js copies an allow-list.
import http from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuestions, plainWording } from '../../scripts/validate.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.PORT) || 8010;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const writeJson = (path, value) => writeFile(join(root, path), JSON.stringify(value, null, 2) + '\n');
const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd: root, maxBuffer: 1 << 24 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, output: `${stdout}${stderr}` }));
});
const git = (args) => new Promise((resolve) => {
  execFile('git', args, { cwd: root, maxBuffer: 1 << 26 }, (error, stdout) => resolve(error ? null : stdout));
});

async function loadTraits() {
  const traits = {};
  for (const file of (await readdir(join(root, 'data/traits'))).filter((f) => f.endsWith('.json'))) {
    for (const [name, trait] of Object.entries(await readJson(`data/traits/${file}`))) traits[name] = { file, ...trait };
  }
  return traits;
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
  return { characters, files, questionFiles, traits: await loadTraits() };
}

// Just the data the validator needs (no git lookups), for fast checks.
async function loadQuestions() {
  const characters = await readJson('data/characters.json');
  const files = await readJson('data/questions/index.json');
  const questions = (await Promise.all(files.map((file) => readJson(`data/questions/${file}`)))).flat();
  return { characters, questions };
}

// Errors the validator would report for this question if it replaced the saved one.
async function errorsFor(file, draft) {
  const { characters, questions } = await loadQuestions();
  const others = questions.filter((q) => q.id !== draft.id);
  const label = `Question ${draft.id}`;
  return checkQuestions([...others, draft], characters).filter((e) => e.startsWith(`${label}:`) || e.startsWith(`${label} `));
}

const strip = ({ _changed, _warnings, ...question }) => question;

async function saveQuestion({ file, question }) {
  const files = await readJson('data/questions/index.json');
  if (!files.includes(file)) return { status: 400, body: { errors: [`Unknown file ${file}`] } };
  const draft = strip(question);
  const errors = await errorsFor(file, draft);
  if (errors.length) return { status: 422, body: { errors } };
  const questions = await readJson(`data/questions/${file}`);
  const index = questions.findIndex((q) => q.id === draft.id);
  if (index < 0) return { status: 404, body: { errors: [`${draft.id} isn't in ${file}`] } };
  // Keep the key order the files use.
  const ordered = {};
  for (const key of ['id', 'plain', 'styled', 'voice', 'yes', 'scope', 'options']) if (draft[key] !== undefined) ordered[key] = draft[key];
  for (const [key, value] of Object.entries(draft)) if (!(key in ordered)) ordered[key] = value;
  questions[index] = ordered;
  await writeJson(`data/questions/${file}`, questions);
  return { status: 200, body: { ok: true } };
}

async function saveTrait({ trait, yes }) {
  const traits = await loadTraits();
  const current = traits[trait];
  if (!current) return { status: 404, body: { errors: [`Unknown trait ${trait}`] } };
  const ids = new Set((await readJson('data/characters.json')).map((c) => c.id));
  const unknown = yes.filter((id) => !ids.has(id));
  if (unknown.length) return { status: 400, body: { errors: [`Unknown characters: ${unknown.join(', ')}`] } };
  const all = await readJson(`data/traits/${current.file}`);
  const keep = all[trait].yes.filter((id) => yes.includes(id));
  all[trait].yes = [...keep, ...yes.filter((id) => !keep.includes(id))];
  // A character can't be on both lists of a subjective trait.
  if (Array.isArray(all[trait].no)) all[trait].no = all[trait].no.filter((id) => !yes.includes(id));
  await writeJson(`data/traits/${current.file}`, all);
  const rebuilt = await run(['scripts/build-characters.js']);
  if (rebuilt.code) return { status: 500, body: { errors: [`build-characters.js failed:\n${rebuilt.output}`] } };
  // Other questions using the trait may now be broken; report them, nothing is rolled back.
  const { characters, questions } = await loadQuestions();
  const errors = checkQuestions(questions, characters);
  return { status: 200, body: { ok: true, errors } };
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
  if (!full.startsWith(normalize(base + sep)) && full !== normalize(base)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    send(res, 200, await readFile(full), TYPES[extname(full)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && pathname === '/api/data') return send(res, 200, await loadAll());
    if (req.method === 'POST' && pathname === '/api/check') {
      const { file, question } = await body(req);
      const draft = strip(question);
      return send(res, 200, { errors: await errorsFor(file, draft), warnings: plainWording(draft.plain ?? '').warnings });
    }
    if (req.method === 'POST' && pathname === '/api/save') {
      const { status, body: result } = await saveQuestion(await body(req));
      return send(res, status, result);
    }
    if (req.method === 'POST' && pathname === '/api/trait') {
      const { status, body: result } = await saveTrait(await body(req));
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
