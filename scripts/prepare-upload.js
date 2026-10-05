// Prepares upload/ for botc.panimu.com (Mythic Beasts, uploaded by hand):
// builds _site/ stamped with the current commit id and copies it, hidden
// files (.htaccess) included, into upload/. Push upload/'s contents as the
// whole web root; never the repo itself.
//
//   npm run upload     (validates and tests first)
import { execFileSync } from 'node:child_process';
import { cp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) {
  console.error('Commit your changes first: the version stamp must match the committed code.');
  process.exit(1);
}
const version = git('rev-parse', '--short=8', 'HEAD');
execFileSync(process.execPath, [join(root, 'scripts/build-site.js'), '--version', version], { cwd: root, stdio: 'inherit' });

const upload = join(root, 'upload');
await rm(upload, { recursive: true, force: true });
await cp(join(root, '_site'), upload, { recursive: true });
const count = async (dir) => {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) n += entry.isDirectory() ? await count(join(dir, entry.name)) : 1;
  return n;
};
console.log(`upload/ holds version ${version} (${await count(upload)} files). Push its contents as the whole web root of botc.panimu.com, including the hidden .htaccess.`);
