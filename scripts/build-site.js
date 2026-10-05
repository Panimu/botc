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

const PAGES = ['index.html', 'quiz.html', 'daily.html'];

// Everything the service worker precaches on install, so the site starts offline:
// the pages, every script, the styles, the game data, the manifest and icons, the
// community banner and the generic token art. Versioned URLs match the requests
// exactly. Character art isn't precached; it's cached as players see it.
export async function precacheList(v = version) {
  const files = async (dir) => (await readdir(join(root, dir))).map((name) => `${dir}/${name}`);
  const questionFiles = (await readJson('data/questions/index.json')).map((file) => `data/questions/${file}`);
  return [
    './', ...PAGES, 'manifest.webmanifest',
    ...[
      'css/style.css',
      ...(await files('js')).filter((path) => path.endsWith('.js')),
      'data/characters.json', 'data/questions/index.json', ...questionFiles, 'data/share-quotes.json',
    ].map((path) => `${path}?v=${v}`),
    ...(await files('resources/icons')), ...(await files('resources/community')), ...(await files('resources/characters/generic')),
  ];
}

async function writeServiceWorker() {
  const source = await readFile(join(root, 'sw.js'), 'utf8');
  const markers = ["const VERSION = 'dev';", 'const PRECACHE = [];'];
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`sw.js is missing ${marker}`);
  const text = source
    .replace(markers[0], `const VERSION = ${JSON.stringify(version)};`)
    .replace(markers[1], `const PRECACHE = ${JSON.stringify(await precacheList(), null, 2)};`);
  await writeFile(join(out, 'sw.js'), text);
}

// The live site's address: link previews need absolute URLs.
const SITE = 'https://botc.panimu.com/';
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One small page per character (you/<id>.html) for the quiz's share link: its
// preview (title, card from scripts/make-share-cards.py) shows the character,
// and anyone who opens it is sent on to the quiz. The description stays generic
// because the shared message already carries the character's quote.
async function writeSharePages(characters) {
  await mkdir(join(out, 'you'), { recursive: true });
  for (const character of characters) {
    const name = escapeHtml(character.name);
    const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>I'm the ${name} | Which Clocktower Character Are You?</title>
  <meta name="robots" content="noindex">
  <meta name="description" content="Which Blood on the Clocktower character are you? Answer yes or no until one is left.">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Clocktower Character Quiz">
  <meta property="og:title" content="I'm the ${name}">
  <meta property="og:description" content="Which Blood on the Clocktower character are you? Answer yes or no until one is left.">
  <meta property="og:url" content="${SITE}you/${character.id}.html">
  <meta property="og:image" content="${SITE}resources/og/characters/${character.id}.jpg?v=${version}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="The ${name} token beside the words: I'm the ${name}.">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${SITE}quiz.html">
  <meta http-equiv="refresh" content="0; url=../quiz.html">
  <script>location.replace('../quiz.html');</script>
  <style>body { margin: 0; padding: 2rem; background: #221932; color: #f3e9d2; font: 1.1rem/1.5 Georgia, serif; } a { color: inherit; }</style>
</head>
<body>
  <p><a href="../quiz.html">Which Clocktower character are you? Take the quiz.</a></p>
</body>
</html>
`;
    await writeFile(join(out, 'you', `${character.id}.html`), page);
  }
}

async function build() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const page of PAGES) await copyStamped(page);
  for (const file of await readdir(join(root, 'js'))) if (file.endsWith('.js')) await copyStamped(`js/${file}`);
  await cp(join(root, 'css'), join(out, 'css'), { recursive: true });
  await cp(join(root, 'resources/characters'), join(out, 'resources/characters'), { recursive: true });
  await cp(join(root, 'resources/community'), join(out, 'resources/community'), { recursive: true });
  await cp(join(root, 'resources/og'), join(out, 'resources/og'), { recursive: true });
  await cp(join(root, 'resources/icons'), join(out, 'resources/icons'), { recursive: true });
  await cp(join(root, 'manifest.webmanifest'), join(out, 'manifest.webmanifest'));
  await writeServiceWorker();
  await writeFile(join(out, '.nojekyll'), '');
  await cp(join(root, '.htaccess'), join(out, '.htaccess'));

  const characters = await readJson('data/characters.json');
  await writeJson('data/characters.json', characters);
  const files = await readJson('data/questions/index.json');
  await writeJson('data/questions/index.json', files);
  for (const file of files) {
    const questions = await readJson(`data/questions/${file}`);
    // Everything except `voice` is published (including optional `options` answer labels).
    await writeJson(`data/questions/${file}`, questions.map(({ voice, ...question }) => question));
  }
  const quotes = await readJson('data/share-quotes.json');
  await writeJson('data/share-quotes.json', Object.fromEntries(Object.entries(quotes).map(([id, { quote }]) => [id, { quote }])));
  await writeSharePages(characters);
}

async function* textFiles(dir) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) yield* textFiles(path);
    else if (['.html', '.js', '.css', '.json', '.webmanifest'].includes(extname(name))) yield path;
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
