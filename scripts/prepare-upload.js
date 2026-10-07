// Prepares upload/ for botc.panimu.com (Mythic Beasts, uploaded by hand): builds
// _site/ stamped with the current commit id, then copies into upload/ only the
// files that changed since the last confirmed upload. Push upload/'s contents into
// the web root (never the repo itself), then run `npm run uploaded`.
//
//   npm run upload             (validates and tests first)
//   npm run upload -- --all    everything, as for a fresh web root
//
// A file that differs only by the version stamp is unchanged; but when anything
// has changed, every stamped file (pages, scripts, sw.js) goes up too, so the new
// stamp reaches all of them together.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, siteManifest, writeState } from './upload-state.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) {
  console.error('Commit your changes first: the version stamp must match the committed code.');
  process.exit(1);
}
const version = git('rev-parse', '--short=8', 'HEAD');
execFileSync(process.execPath, [join(root, 'scripts/build-site.js'), '--version', version], { cwd: root, stdio: 'inherit' });

const site = join(root, '_site');
const { files, stamped } = await siteManifest(site, version);
const state = await readState();
const before = process.argv.includes('--all') ? null : state.confirmed;

const changed = before ? Object.keys(files).filter((path) => before.files[path] !== files[path]) : Object.keys(files);
const removed = before ? Object.keys(before.files).filter((path) => !(path in files)) : [];
const send = new Set(changed);
if (changed.length) for (const path of stamped) send.add(path);

const upload = join(root, 'upload');
await rm(upload, { recursive: true, force: true });
await mkdir(upload);
for (const path of send) {
  await mkdir(join(upload, path, '..'), { recursive: true });
  await cp(join(site, path), join(upload, path));
}
await writeState({ ...state, pending: { version, files } });

const list = (paths) => (paths.length > 12 ? [...paths.slice(0, 12), `… and ${paths.length - 12} more`] : paths).map((p) => `  ${p}`).join('\n');
if (!before) {
  console.log(`upload/ holds all of version ${version} (${send.size} files). Push it as the whole web root of botc.panimu.com, including the hidden .htaccess, then run: npm run uploaded`);
} else if (!send.size && !removed.length) {
  console.log(`Nothing to upload: version ${version} is the same as ${before.version}, which is already on the server, apart from the stamp. upload/ is empty.`);
} else {
  console.log(`upload/ holds ${send.size} files for version ${version} (the server has ${before.version}).`);
  if (changed.length) console.log(`Changed (${changed.length}):\n${list(changed)}`);
  const restamped = [...send].filter((path) => !changed.includes(path));
  if (restamped.length) console.log(`Stamp only, sent so every page and script carries ${version} (${restamped.length}):\n${list(restamped)}`);
  if (removed.length) console.log(`Delete these from the server by hand (${removed.length}):\n${list(removed)}`);
  console.log('Push upload/\'s contents into the web root, overwriting (show hidden files if .htaccess is listed), then run: npm run uploaded');
}
