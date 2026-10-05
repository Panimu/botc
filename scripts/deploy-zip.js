// Packages the site for botc.panimu.com (Mythic Beasts, uploaded by hand):
// builds _site/ stamped with the current commit id and zips it, hidden files
// (.htaccess) included, into deploy/botc-site-<commit>.zip. Upload the zip's
// contents as the whole web root; never the repo itself.
//
//   npm run deploy-zip     (validates and tests first)
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (git('status', '--porcelain')) {
  console.error('Commit your changes first: the version stamp must match the committed code.');
  process.exit(1);
}
const version = git('rev-parse', '--short=8', 'HEAD');
execFileSync(process.execPath, [join(root, 'scripts/build-site.js'), '--version', version], { cwd: root, stdio: 'inherit' });

async function* files(dir) {
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) yield* files(path);
    else yield path;
  }
}

// A minimal zip writer (deflate, no dependencies).
const site = join(root, '_site');
const parts = [];
const central = [];
let offset = 0;
for await (const path of files(site)) {
  const name = Buffer.from(relative(site, path).split(sep).join('/'));
  const data = await readFile(path);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  parts.push(header, name, packed);
  central.push(entry, name);
  offset += header.length + name.length + packed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

await mkdir(join(root, 'deploy'), { recursive: true });
const zip = join(root, 'deploy', `botc-site-${version}.zip`);
await writeFile(zip, Buffer.concat([...parts, directory, end]));
console.log(`Wrote ${relative(root, zip)} (${central.length / 2} files). Upload its contents as the whole web root of botc.panimu.com.`);
