// Builds the publishable site into _site/: only the files the browser needs,
// with authoring-only fields stripped, then fails if any banned name appears.
//
//   node scripts/build-site.js                    build with ?v=dev asset URLs
//   node scripts/build-site.js --version abc123   stamp asset URLs (deploys)
//
// Authoring data keeps `voice` (who each styled line imitates); it is never published.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, '_site');
const version = process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : 'dev';

// Never published: the names of the people and characters the styled lines imitate.
const BANNED = ['Carl', 'Princess Donut', 'Donut', 'Mordecai', 'Katia', 'Zev', 'Odette', 'Mongo', 'Samantha',
  'Prepotente', 'System AI', 'Dinniman', 'Dungeon Crawler', 'crawler'];
const BANNED_CASE_SENSITIVE = ['Elle'];

const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const writeJson = async (path, value) => {
  await mkdir(join(out, path, '..'), { recursive: true });
  await writeFile(join(out, path), JSON.stringify(value));
};

async function copyStamped(path) {
  const text = (await readFile(join(root, path), 'utf8')).replaceAll('?v=dev', `?v=${version}`);
  await mkdir(join(out, path, '..'), { recursive: true });
  await writeFile(join(out, path), text);
}

async function build() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const page of ['index.html', 'quiz.html', 'daily.html']) await copyStamped(page);
  for (const file of await readdir(join(root, 'js'))) if (file.endsWith('.js')) await copyStamped(`js/${file}`);
  await cp(join(root, 'css'), join(out, 'css'), { recursive: true });
  await cp(join(root, 'resources/characters'), join(out, 'resources/characters'), { recursive: true });
  await cp(join(root, 'resources/community'), join(out, 'resources/community'), { recursive: true });
  await cp(join(root, 'resources/og'), join(out, 'resources/og'), { recursive: true });
  await writeFile(join(out, '.nojekyll'), '');

  await writeJson('data/characters.json', await readJson('data/characters.json'));
  const files = await readJson('data/questions/index.json');
  await writeJson('data/questions/index.json', files);
  for (const file of files) {
    const questions = await readJson(`data/questions/${file}`);
    // Everything except `voice` is published (including optional `options` answer labels).
    await writeJson(`data/questions/${file}`, questions.map(({ voice, ...question }) => question));
  }
  const quotes = await readJson('data/share-quotes.json');
  await writeJson('data/share-quotes.json', Object.fromEntries(Object.entries(quotes).map(([id, { quote }]) => [id, { quote }])));
}

async function* textFiles(dir) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) yield* textFiles(path);
    else if (['.html', '.js', '.css', '.json'].includes(extname(name))) yield path;
  }
}

// A name, optionally pluralised or possessive ("Donuts", "Carl's"), as a whole word.
const word = (names) => `(^|[^A-Za-z])((?:${names.join('|')})(?:es|s|'s|’s)?)([^A-Za-z]|$)`;
export const BANNED_PATTERNS = [new RegExp(word(BANNED), 'i'), new RegExp(word(BANNED_CASE_SENSITIVE))];

async function scan() {
  const [anyCase, exact] = BANNED_PATTERNS;
  const problems = [];
  for await (const path of textFiles(out)) {
    const text = await readFile(path, 'utf8');
    for (const re of [anyCase, exact]) {
      const match = text.match(re);
      if (match) problems.push(`${path.slice(out.length + 1)}: "${match[2]}" near "${text.slice(Math.max(0, match.index - 30), match.index + 40).replace(/\s+/g, ' ')}"`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
  const problems = await scan();
  if (problems.length) {
    console.error(`Banned names found in the built site:\n${problems.join('\n')}`);
    process.exit(1);
  }
  console.log(`Built _site (version ${version}); no banned names found.`);
}
