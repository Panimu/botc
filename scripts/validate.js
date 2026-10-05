// Checks the data and reports how well the questions cover the characters.
//
//   node scripts/validate.js                 full check, coverage and simulated games
//   node scripts/validate.js townsfolk.json  integrity of just these question files
//   --verbose                                list every unseparated pair group
//
// Integrity problems exit 1. Coverage is reported, not enforced: when no question
// can split the remaining characters, the game ends listing all of them.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { artPath } from '../js/art.js';
import { Game, prepare, splits } from '../js/engine.js';
import { loadData } from './load.js';

const TEAMS = new Set(['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled', 'loric']);
const exists = (path) => existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));

export function checkCharacters(characters) {
  const errors = [];
  const ids = new Set();
  for (const c of characters) {
    if (!c.id || !c.name || !c.summary) errors.push(`Character missing id/name/summary: ${JSON.stringify(c)}`);
    if (ids.has(c.id)) errors.push(`Duplicate character id: ${c.id}`);
    if (!TEAMS.has(c.team)) errors.push(`Character ${c.id} has unknown team: ${c.team}`);
    if (!exists(artPath(c))) errors.push(`Character ${c.id} has no art at ${artPath(c)}`);
    ids.add(c.id);
  }
  return errors;
}

function checkSelector(selector, label, ids, fields) {
  const errors = [];
  if (Array.isArray(selector)) {
    for (const id of selector) if (!ids.has(id)) errors.push(`${label} names unknown character "${id}"`);
    if (new Set(selector).size !== selector.length) errors.push(`${label} lists a character twice`);
  } else if (selector && typeof selector === 'object') {
    for (const field of Object.keys(selector)) if (!fields.has(field)) errors.push(`${label} matches unknown field "${field}"`);
  } else {
    errors.push(`${label} must be a list of ids or a match object`);
  }
  return errors;
}

export function checkQuestions(questions, characters, seen = { ids: new Set(), texts: new Set() }) {
  const errors = [];
  const ids = new Set(characters.map((c) => c.id));
  const fields = new Set(characters.flatMap((c) => Object.keys(c)));
  for (const q of questions) {
    const label = `Question ${q.id ?? JSON.stringify(q).slice(0, 60)}`;
    if (!q.id) errors.push(`${label} has no id`);
    if (seen.ids.has(q.id)) errors.push(`${label}: duplicate id`);
    seen.ids.add(q.id);
    for (const key of ['plain', 'styled']) {
      if (typeof q[key] !== 'string' || !q[key].trim()) errors.push(`${label} needs a "${key}" phrasing`);
      else if (seen.texts.has(q[key])) errors.push(`${label}: "${key}" text duplicates another question`);
      else if (q[key].includes('\u2014')) errors.push(`${label}: "${key}" contains an em dash; use a comma, colon or full stop`);
      else seen.texts.add(q[key]);
    }
    if (typeof q.voice !== 'string' || !q.voice.trim()) errors.push(`${label} needs a "voice" crediting the styled line`);
    const selectorErrors = [...checkSelector(q.yes, `${label} yes`, ids, fields), ...(q.scope ? checkSelector(q.scope, `${label} scope`, ids, fields) : [])];
    errors.push(...selectorErrors);
    if (selectorErrors.length) continue;

    const { yesSet, scopeSet } = prepare(q, characters);
    const scopeSize = scopeSet?.size ?? ids.size;
    if (scopeSet && Array.isArray(q.yes)) {
      for (const id of q.yes) if (!scopeSet.has(id)) errors.push(`${label}: yes character "${id}" is outside its scope`);
    }
    if (yesSet.size === 0) errors.push(`${label}: nobody is on the yes side`);
    if (yesSet.size >= scopeSize) errors.push(`${label}: everyone in scope is on the yes side, so it never splits`);
    if (scopeSet && scopeSet.size < 2) errors.push(`${label}: scope has fewer than 2 characters`);
  }
  return errors;
}

// How many questions mix character types: more than one type on the yes side,
// and on both sides. Reported, not enforced.
export function typeMix(questions, characters) {
  const team = new Map(characters.map((c) => [c.id, c.team]));
  let mixedYes = 0;
  let mixedBoth = 0;
  for (const q of questions) {
    const { yesSet, scopeSet } = prepare(q, characters);
    const no = [...(scopeSet ?? team.keys())].filter((id) => !yesSet.has(id));
    const yesTeams = new Set([...yesSet].map((id) => team.get(id))).size;
    const noTeams = new Set(no.map((id) => team.get(id))).size;
    if (yesTeams > 1) mixedYes++;
    if (yesTeams > 1 && noTeams > 1) mixedBoth++;
  }
  return { mixedYes, mixedBoth };
}

export async function checkTraits(characters) {
  const errors = [];
  const ids = new Set(characters.map((c) => c.id));
  const dir = new URL('../data/traits/', import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    let traits;
    try { traits = JSON.parse(await readFile(new URL(file, dir), 'utf8')); } catch (e) { errors.push(`data/traits/${file}: invalid JSON (${e.message})`); continue; }
    for (const [name, trait] of Object.entries(traits)) {
      if (!/^[a-z][A-Za-z]+$/.test(name)) errors.push(`Trait ${name} (${file}): use a camelCase name`);
      if (typeof trait.definition !== 'string' || trait.definition.length < 20) errors.push(`Trait ${name} (${file}): needs a precise definition`);
      if (!Array.isArray(trait.yes) || trait.yes.length < 2) { errors.push(`Trait ${name} (${file}): needs a yes list of at least 2 characters`); continue; }
      for (const id of trait.yes) if (!ids.has(id)) errors.push(`Trait ${name} (${file}): unknown character "${id}"`);
      if (trait.no !== undefined) {
        if (!Array.isArray(trait.no)) errors.push(`Trait ${name} (${file}): "no" must be a list`);
        else {
          for (const id of trait.no) if (!ids.has(id)) errors.push(`Trait ${name} (${file}): unknown character "${id}" in no`);
          const both = trait.no.filter((id) => trait.yes.includes(id));
          if (both.length) errors.push(`Trait ${name} (${file}): ${both.join(', ')} listed as both yes and no`);
        }
      }
      if (!characters.every((c) => name in c)) errors.push(`Trait ${name} (${file}): not in data/characters.json yet; run node scripts/build-characters.js`);
    }
  }
  return errors;
}

// Pairs of characters that no question can tell apart (both in scope, exactly one on the yes side).
export function coverage(questions, characters) {
  const prepared = questions.map((q) => prepare(q, characters));
  const list = characters.map((c) => c.id);
  const unseparated = [];
  let globalOnly = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const pair = [list[i], list[j]];
      const separating = prepared.filter((q) => splits(q, pair));
      if (!separating.length) unseparated.push(pair);
      if (separating.some((q) => !q.scopeSet)) globalOnly++;
    }
  }
  return { totalPairs: (list.length * (list.length - 1)) / 2, unseparated, globalOnly };
}

// Plays truthful games for every character and measures length and unresolved endings.
export function simulate(questions, characters, gamesPerCharacter = 2) {
  let seed = 1;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const game = new Game({ characters, questions, rng });
  const lengths = [];
  let unresolved = 0;
  let leftOver = 0;
  for (const { id } of characters) {
    for (let n = 0; n < gamesPerCharacter; n++) {
      game.restart();
      while (!game.done) game.answer(game.current.yesSet.has(id));
      const results = game.results.map((c) => c.id);
      if (!results.includes(id)) throw new Error(`Game for ${id} ended on ${results.join(', ')}`);
      if (results.length > 1) { unresolved++; leftOver += results.length; }
      lengths.push(game.history.length);
    }
  }
  lengths.sort((a, b) => a - b);
  return {
    games: lengths.length,
    mean: lengths.reduce((a, b) => a + b, 0) / lengths.length,
    median: lengths[Math.floor(lengths.length / 2)],
    min: lengths[0],
    max: lengths.at(-1),
    unresolved,
    meanLeftOver: unresolved ? leftOver / unresolved : 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.filter((a) => a.endsWith('.json'));
  const { characters, files, questionFiles, questions } = await loadData();

  const errors = [...checkCharacters(characters), ...(await checkTraits(characters))];
  const onDisk = (await readdir(new URL('../data/questions/', import.meta.url))).filter((f) => f.endsWith('.json') && f !== 'index.json');
  for (const f of onDisk) if (!files.includes(f)) errors.push(`data/questions/${f} is not listed in data/questions/index.json`);

  const seen = { ids: new Set(), texts: new Set() };
  for (const { file, questions: qs } of questionFiles) {
    const fileErrors = checkQuestions(qs, characters, seen);
    if (!only.length || only.includes(file)) errors.push(...fileErrors.map((e) => `${file}: ${e}`));
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`\n${errors.length} problem(s) found.`);
    process.exit(1);
  }
  if (only.length) {
    const count = questionFiles.filter((f) => only.includes(f.file)).reduce((n, f) => n + f.questions.length, 0);
    console.log(`OK: ${count} questions in ${only.join(', ')}.`);
    return;
  }

  const { totalPairs, unseparated, globalOnly } = coverage(questions, characters);
  const pct = (n) => `${((100 * n) / totalPairs).toFixed(1)}%`;
  console.log(`OK: ${characters.length} characters, ${questions.length} questions in ${files.length} files.`);
  console.log(`Separable pairs: ${totalPairs - unseparated.length} of ${totalPairs} (${pct(totalPairs - unseparated.length)}); by global questions alone: ${pct(globalOnly)}.`);
  if (unseparated.length) {
    const shown = args.includes('--verbose') ? unseparated : unseparated.slice(0, 10);
    for (const [a, b] of shown) console.log(`  not separated: ${a} / ${b}`);
    if (shown.length < unseparated.length) console.log(`  … ${unseparated.length - shown.length} more (--verbose)`);
  }

  const mix = typeMix(questions, characters);
  const share = (n) => `${((100 * n) / questions.length).toFixed(0)}%`;
  console.log(`Questions mixing character types: ${mix.mixedYes} (${share(mix.mixedYes)}) have more than one type on the yes side; ${mix.mixedBoth} (${share(mix.mixedBoth)}) on both sides.`);

  const sim = simulate(questions, characters);
  console.log(`Simulated ${sim.games} games: ${sim.mean.toFixed(1)} questions on average (median ${sim.median}, range ${sim.min}–${sim.max}).`);
  console.log(`Games ending without a single character: ${sim.unresolved} (${((100 * sim.unresolved) / sim.games).toFixed(1)}%)${sim.unresolved ? `, ${sim.meanLeftOver.toFixed(1)} characters left on average` : ''}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
