// Checks the data and reports how well the questions cover the characters.
//
//   node scripts/validate.js                 full check, coverage and simulated games
//   node scripts/validate.js townsfolk.json  integrity of just these question files
//   --verbose                                list every unseparated pair group and wording warning
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

// Plain-wording rules from data/questions/GUIDE.md ("The two phrasings"): hard
// rules are errors, judgement calls are warnings.
export const PLAIN_MAX_WORDS = 30;
export const PLAIN_AIM_WORDS = 22;
const NEGATIVES = /\b(?:not|never|no|nothing|nobody|none|neither|nor|without|unless)\b|n't\b/gi;
export function plainWording(plain) {
  const errors = [];
  const warnings = [];
  const text = plain.trim();
  const words = text.split(/\s+/).length;
  if (!text.endsWith('?')) errors.push('must end with "?"');
  if ((text.match(/\?/g) ?? []).length > 1) errors.push('asks more than one question');
  if (/[()[\]]/.test(text)) errors.push('uses brackets');
  if (text.includes(';')) errors.push('uses a semicolon');
  if (text.includes('/')) errors.push('uses a slash; write "yes or no", not "yes/no"');
  if (/\b(?:e\.g|i\.e|etc)\b|\b(?:ST|TB|BMR|SnV|S&V)\b/.test(text)) errors.push('uses an abbreviation');
  if (words > PLAIN_MAX_WORDS) errors.push(`is ${words} words (limit ${PLAIN_MAX_WORDS})`);
  else if (words > PLAIN_AIM_WORDS) warnings.push(`is ${words} words (aim for ${PLAIN_AIM_WORDS} or fewer)`);
  if ((text.match(NEGATIVES) ?? []).length >= 2) warnings.push('may be a double negative');
  return { errors, warnings };
}

// Two questions split alike when they put the same characters on each side within
// the same scope (asked either way round). Only one question per split is allowed:
// a second one can never be asked once the first is answered, and it doubles how
// often that split is offered.
export function splitKey(yesSet, scopeSet, allIds) {
  const pool = scopeSet ? [...scopeSet] : allIds;
  const yes = pool.filter((id) => yesSet.has(id)).sort().join();
  const no = pool.filter((id) => !yesSet.has(id)).sort().join();
  return `${scopeSet ? [...scopeSet].sort().join() : '*'}|${yes <= no ? yes : no}`;
}

export function checkQuestions(questions, characters, seen = { ids: new Set(), texts: new Set(), splits: new Map() }) {
  seen.splits ??= new Map();
  const allIds = characters.map((c) => c.id);
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
      if (key === 'plain' && typeof q.plain === 'string') errors.push(...plainWording(q.plain).errors.map((e) => `${label}: plain wording ${e}`));
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
    const key = splitKey(yesSet, scopeSet, allIds);
    if (seen.splits.has(key)) errors.push(`${label}: splits exactly like ${seen.splits.get(key)}; keep just one question per split`);
    else seen.splits.set(key, q.id);
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

// The rules for one trait, shared with the editor so it can refuse a draft before
// writing it. `ids` is the set of known character ids.
export const TRAIT_NAME = /^[a-z][A-Za-z]+$/;
export const TRAIT_MIN_DEFINITION = 20;
export const TRAIT_MIN_YES = 2;

export function traitProblems(name, trait, ids) {
  const problems = [];
  if (!TRAIT_NAME.test(name ?? '')) problems.push('the name must be camelCase letters only, like "killsByDay" (no digits or symbols)');
  if (typeof trait?.definition !== 'string' || trait.definition.trim().length < TRAIT_MIN_DEFINITION) problems.push(`the definition needs at least ${TRAIT_MIN_DEFINITION} characters: say what counts, and what doesn't`);
  if (!Array.isArray(trait?.yes) || trait.yes.length < TRAIT_MIN_YES) { problems.push(`the yes list needs at least ${TRAIT_MIN_YES} characters`); return problems; }
  const unknown = trait.yes.filter((id) => !ids.has(id));
  if (unknown.length) problems.push(`unknown characters in yes: ${unknown.join(', ')}`);
  const dupes = trait.yes.filter((id, i) => trait.yes.indexOf(id) !== i);
  if (dupes.length) problems.push(`listed twice in yes: ${[...new Set(dupes)].join(', ')}`);
  if (trait.no !== undefined && trait.no !== null) {
    if (!Array.isArray(trait.no)) problems.push('"no" must be a list');
    else {
      const unknownNo = trait.no.filter((id) => !ids.has(id));
      if (unknownNo.length) problems.push(`unknown characters in no: ${unknownNo.join(', ')}`);
      const both = trait.no.filter((id) => trait.yes.includes(id));
      if (both.length) problems.push(`on both the yes and no lists: ${both.join(', ')}`);
    }
  }
  return problems;
}

export async function checkTraits(characters) {
  const errors = [];
  const ids = new Set(characters.map((c) => c.id));
  const dir = new URL('../data/traits/', import.meta.url);
  const seen = new Map();
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    let traits;
    try { traits = JSON.parse(await readFile(new URL(file, dir), 'utf8')); } catch (e) { errors.push(`data/traits/${file}: invalid JSON (${e.message})`); continue; }
    for (const [name, trait] of Object.entries(traits)) {
      for (const problem of traitProblems(name, trait, ids)) errors.push(`Trait ${name} (${file}): ${problem}`);
      if (seen.has(name)) errors.push(`Trait ${name} (${file}): also defined in ${seen.get(name)}`);
      seen.set(name, file);
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

  const seen = { ids: new Set(), texts: new Set(), splits: new Map() };
  for (const { file, questions: qs } of questionFiles) {
    const fileErrors = checkQuestions(qs, characters, seen);
    if (!only.length || only.includes(file)) errors.push(...fileErrors.map((e) => `${file}: ${e}`));
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`\n${errors.length} problem(s) found.`);
    process.exit(1);
  }
  const warnings = questionFiles.filter((f) => !only.length || only.includes(f.file))
    .flatMap(({ file, questions: qs }) => qs.flatMap((q) => plainWording(q.plain).warnings.map((w) => `${file}: ${q.id}: plain wording ${w}`)));
  if (warnings.length) {
    const shown = args.includes('--verbose') ? warnings : warnings.slice(0, 10);
    console.log(`Plain wording warnings: ${warnings.length} (see data/questions/GUIDE.md).`);
    for (const w of shown) console.log(`  ${w}`);
    if (shown.length < warnings.length) console.log(`  … ${warnings.length - shown.length} more (--verbose)`);
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
