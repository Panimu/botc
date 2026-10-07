// After pushing upload/ to botc.panimu.com: records that version as what the server
// has, so the next `npm run upload` holds only what changes after it, and empties upload/.
//
//   npm run uploaded
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readState, writeState } from './upload-state.js';

const state = await readState();
if (!state.pending) {
  console.error('Nothing prepared: run npm run upload first.');
  process.exit(1);
}
await writeState({ confirmed: state.pending });
const upload = fileURLToPath(new URL('../upload/', import.meta.url));
await rm(upload, { recursive: true, force: true });
await mkdir(upload);
console.log(`Recorded version ${state.pending.version} as live on botc.panimu.com; upload/ is empty.`);
