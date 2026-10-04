// Loads characters and every question file listed in data/questions/index.json from disk.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
export const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

export async function loadData() {
  const characters = await readJson('data/characters.json');
  const files = await readJson('data/questions/index.json');
  const questionFiles = await Promise.all(files.map(async (file) => ({ file, questions: await readJson(`data/questions/${file}`) })));
  return { characters, files, questionFiles, questions: questionFiles.flatMap((f) => f.questions) };
}
