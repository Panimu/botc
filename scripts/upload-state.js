// What was last uploaded to botc.panimu.com, so upload/ can hold only what changed.
// Kept in .cache/upload-state.json (not committed):
//   { confirmed: { version, files: { path: hash } }, pending: { version, files } }
// `confirmed` is what's on the server; `pending` is what upload/ was last prepared
// from, promoted to confirmed by `npm run uploaded`.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const STATE = join(root, '.cache/upload-state.json');
const TEXT = new Set(['.html', '.js', '.json', '.css', '.webmanifest', '.htaccess', '.txt', '.svg', '']);

export async function* walk(dir, base = dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path, base);
    else yield path.slice(base.length + 1).replaceAll('\\', '/');
  }
}

const isText = (path) => TEXT.has(extname(path)) || path.endsWith('.htaccess');

// Every file in a built site, hashed with the version stamp taken out, so a file
// that differs only by the stamp counts as unchanged. Also lists the stamped files.
export async function siteManifest(dir, version) {
  const files = {};
  const stamped = [];
  for await (const path of walk(dir)) {
    let content = await readFile(join(dir, path));
    if (isText(path)) {
      const text = content.toString('utf8');
      if (text.includes(version)) stamped.push(path);
      content = Buffer.from(text.replaceAll(version, '<version>'));
    }
    files[path] = createHash('sha1').update(content).digest('hex');
  }
  return { files, stamped };
}

export async function readState() {
  try { return JSON.parse(await readFile(STATE, 'utf8')); } catch { return {}; }
}

export async function writeState(state) {
  await mkdir(join(STATE, '..'), { recursive: true });
  await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
}
