// Generates data/characters.json from the reference data in resources/.
// Re-run after resources/data changes: node scripts/build-characters.js
//
// Besides the basics, each character gets boolean flags derived from the night
// order and ability text, plus the hand-tagged traits in data/traits/, so questions can select characters by fact
// (see `match` in data/questions.json) instead of listing ids by hand.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

const roles = await read('resources/data/roles.json');
const night = await read('resources/data/nightsheet.json');
const firstNight = new Set(night.firstNight);

// Hand-tagged cross-team traits: data/traits/*.json, each { traitName: { definition, yes: [ids], no?: [ids] } }.
// A trait with a `no` list also gets a `<name>Clear` field (true for clear yes or clear no),
// so subjective questions can scope out borderline characters with { "<name>Clear": true }.
const traits = {};
for (const file of (await readdir(new URL('data/traits/', root))).filter((f) => f.endsWith('.json'))) {
  for (const [name, trait] of Object.entries(await read(`data/traits/${file}`))) {
    if (traits[name]) throw new Error(`Trait ${name} is defined twice`);
    traits[name] = new Set(trait.yes);
    if (Array.isArray(trait.no)) traits[`${name}Clear`] = new Set([...trait.yes, ...trait.no]);
  }
}
const otherNight = new Set(night.otherNight);

// Flag name -> pattern tested against the ability text.
const ABILITY_FLAGS = {
  oncePerGame: /once per game/i,
  startsKnowing: /you start knowing/i,
  learns: /\blearns?\b/i,
  choosesPlayers: /\bchooses?\b/i,
  aboutDeath: /\b(die|dies|died|dead|death|kill|kills|killed)\b/i,
  aboutVoting: /\b(nominat\w*|execut\w*|vote\w*|voting)\b/i,
  madness: /\bmad\b/i,
  drunkOrPoisoned: /\b(drunk|poisoned)\b/i,
  aboutAlignment: /\b(good|evil)\b/i,
};

const EVIL = new Set(['minion', 'demon']);
// Storyteller-side characters aren't part of the quiz.
const EXCLUDED_TEAMS = new Set(['fabled', 'loric']);

function image(role) {
  const suffixed = `resources/characters/${role.edition}/${role.id}_${EVIL.has(role.team) ? 'e' : 'g'}.webp`;
  const plain = `resources/characters/${role.edition}/${role.id}.webp`;
  if (existsSync(new URL(suffixed, root))) return suffixed;
  if (existsSync(new URL(plain, root))) return plain;
  throw new Error(`No art for ${role.id}`);
}

const characters = roles.filter((role) => !EXCLUDED_TEAMS.has(role.team)).map((role) => {
  const character = {
    id: role.id,
    name: role.name,
    team: role.team,
    edition: role.edition,
    summary: role.ability,
    image: image(role),
    firstNight: firstNight.has(role.id),
    otherNight: otherNight.has(role.id),
    setup: Boolean(role.setup),
  };
  for (const [flag, pattern] of Object.entries(ABILITY_FLAGS)) character[flag] = pattern.test(role.ability);
  for (const [name, members] of Object.entries(traits)) character[name] = members.has(role.id);
  return character;
});

const json = `[\n${characters.map((c) => `  ${JSON.stringify(c)}`).join(',\n')}\n]\n`;
await writeFile(new URL('data/characters.json', root), json);
console.log(`Wrote ${characters.length} characters to data/characters.json`);
