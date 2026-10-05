// Question editor client. The server (tools/editor/server.js) reads and writes
// the data files and checks every save with the validator's own rules.
import { select } from '/js/engine.js';

const $ = (id) => document.getElementById(id);
const TEAMS = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'];
const TEAM_LABEL = { townsfolk: 'Townsfolk', outsider: 'Outsiders', minion: 'Minions', demon: 'Demons', traveller: 'Travellers' };
const REVIEW_KEY = 'question-editor-review';

const state = {
  data: null,
  characters: [],
  byId: new Map(), // id -> { file, question (as saved), yes: Set (as saved) }
  current: null,
  drafts: new Map(), // id -> edited copy of the question
  traitDraft: null, // { trait, yes: Set, saved: Set } while editing a trait
  mode: 'yes',
  queue: [],
  reviewed: new Set(),
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const strip = ({ _changed, _warnings, ...question }) => question;
const resolve = (selector) => (selector ? select(selector, state.characters) : null);
const nameOf = (id) => state.characters.find((c) => c.id === id)?.name ?? id;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

async function api(path, payload) {
  const res = await fetch(path, payload === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

// ---- Loading ---------------------------------------------------------------

async function load() {
  const { body } = await api('/api/data');
  state.data = body;
  state.characters = body.characters;
  state.byId = new Map();
  for (const { file, questions } of body.questionFiles) {
    for (const question of questions) {
      const scope = question.scope ? new Set(resolve(question.scope)) : null;
      state.byId.set(question.id, { file, question, yes: new Set(resolve(question.yes).filter((id) => !scope || scope.has(id))) });
    }
  }
  renderFilters();
  renderCounts();
  renderBrowse();
  renderReview();
}

const savedOf = (id) => state.byId.get(id);
const draftOf = (id) => state.drafts.get(id) ?? clone(strip(savedOf(id).question));
const isDirty = (id) => state.drafts.has(id) && JSON.stringify(state.drafts.get(id)) !== JSON.stringify(strip(savedOf(id).question));
const traitDirty = () => state.traitDraft && [...state.traitDraft.yes].sort().join() !== [...state.traitDraft.saved].sort().join();

function renderCounts() {
  const total = state.byId.size;
  const unsaved = [...state.byId.keys()].filter(isDirty).length;
  $('counts').textContent = `${total} questions in ${state.data.files.length} files, ${state.characters.length} characters${unsaved ? `. ${unsaved} unsaved` : ''}`;
}

function renderFilters() {
  const files = $('file-filter');
  if (files.options.length === 1) {
    for (const file of state.data.files) files.append(new Option(file, file));
    const characters = $('character-filter');
    for (const c of [...state.characters].sort((a, b) => a.name.localeCompare(b.name))) characters.append(new Option(c.name, c.id));
  }
}

// ---- Browse ----------------------------------------------------------------

function listItem(id, { done } = {}) {
  const entry = savedOf(id);
  const li = el('li');
  if (!entry) {
    li.className = 'missing';
    li.textContent = `${id} (not found)`;
    return li;
  }
  if (done) li.classList.add('done');
  const marks = [];
  if (isDirty(id)) marks.push('● unsaved');
  if (entry.question._warnings.length) marks.push('⚠');
  if (entry.question._changed) marks.push('Δ');
  li.append(el('span', 'marks', `${marks.join(' ')} ${entry.file.replace('.json', '')}`), el('span', 'id', id), document.createTextNode(draftOf(id).plain));
  li.setAttribute('aria-current', String(id === state.current));
  li.addEventListener('click', () => open(id));
  return li;
}

function renderBrowse() {
  const words = $('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const file = $('file-filter').value;
  const character = $('character-filter').value;
  const ids = [...state.byId.keys()].filter((id) => {
    const { file: f, question, yes } = savedOf(id);
    if (file && f !== file) return false;
    if (character && !yes.has(character)) return false;
    if ($('only-warnings').checked && !question._warnings.length) return false;
    if ($('only-changed').checked && !question._changed) return false;
    if ($('only-unsaved').checked && !isDirty(id)) return false;
    const text = `${id} ${question.plain} ${question.styled}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  $('result-count').textContent = `${ids.length} question${ids.length === 1 ? '' : 's'}`;
  $('browse-list').replaceChildren(...ids.map((id) => listItem(id)));
}

// ---- Review list -----------------------------------------------------------

function saveReview() {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify({ queue: state.queue, reviewed: [...state.reviewed] })); } catch {}
}

function loadReview() {
  try {
    const saved = JSON.parse(localStorage.getItem(REVIEW_KEY));
    if (saved) { state.queue = saved.queue ?? []; state.reviewed = new Set(saved.reviewed ?? []); }
  } catch {}
}

// Every known question id in the text, in order of first appearance.
function idsIn(text) {
  const found = [];
  for (const token of text.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? []) if (state.byId.has(token) && !found.includes(token)) found.push(token);
  return found;
}

function setQueue(ids) {
  state.queue = ids;
  state.reviewed = new Set([...state.reviewed].filter((id) => ids.includes(id)));
  saveReview();
  renderReview();
  if (ids.length) open(ids[0]);
}

function renderReview() {
  const done = state.queue.filter((id) => state.reviewed.has(id)).length;
  $('review-progress').textContent = state.queue.length ? `${done} of ${state.queue.length} reviewed` : 'No list loaded.';
  $('review-list').replaceChildren(...state.queue.map((id) => listItem(id, { done: state.reviewed.has(id) })));
  const inQueue = state.queue.includes(state.current);
  $('reviewed-wrap').hidden = !inQueue;
  $('reviewed').checked = state.reviewed.has(state.current);
}

function step(delta) {
  if (!state.queue.length) return;
  const at = state.queue.indexOf(state.current);
  const next = at < 0 ? 0 : Math.min(state.queue.length - 1, Math.max(0, at + delta));
  open(state.queue[next]);
}

// ---- Editor ----------------------------------------------------------------

function open(id) {
  if (traitDirty() && id !== state.current) {
    setStatus('Save or discard the trait change first.', 'bad');
    return;
  }
  if (id !== state.current) state.traitDraft = null;
  state.current = id;
  history.replaceState(null, '', `#${id}`);
  const { file } = savedOf(id);
  const draft = draftOf(id);
  $('empty').hidden = true;
  $('editor').hidden = false;
  $('q-id').textContent = id;
  $('q-file').textContent = file;
  $('plain').value = draft.plain;
  $('styled').value = draft.styled;
  $('voice').value = draft.voice ?? '';
  $('notice').hidden = true;
  setStatus('');
  renderEditor();
  renderBrowse();
  renderReview();
  check();
}

function update(change) {
  const draft = draftOf(state.current);
  change(draft);
  state.drafts.set(state.current, draft);
  renderEditor();
  renderCounts();
  scheduleCheck();
}

// A selector that is exactly one trait set to true, like { "killsByDay": true }.
function singleTrait(selector) {
  if (!selector || Array.isArray(selector)) return null;
  const entries = Object.entries(selector);
  return entries.length === 1 && entries[0][1] === true && state.data.traits[entries[0][0]] ? entries[0][0] : null;
}

const usesOf = (trait) => [...state.byId.values()].filter(({ question }) => JSON.stringify([question.yes, question.scope ?? null]).includes(`"${trait}"`)).length;

function sides(draft) {
  const scope = draft.scope ? new Set(resolve(draft.scope)) : null;
  const yes = state.traitDraft ? new Set(state.traitDraft.yes) : new Set(resolve(draft.yes).filter((id) => !scope || scope.has(id)));
  return { scope, yes };
}

function renderEditor() {
  const id = state.current;
  const draft = draftOf(id);
  $('q-dirty').hidden = !isDirty(id) && !traitDirty();
  const words = draft.plain.trim().split(/\s+/).filter(Boolean).length;
  $('plain-count').textContent = `${words} words`;

  // Where the yes side and the scope come from.
  const trait = singleTrait(draft.yes);
  const yesLine = $('yes-summary');
  yesLine.replaceChildren();
  if (state.traitDraft) {
    yesLine.append('Yes side: editing trait ', el('code', '', state.traitDraft.trait), ` for all ${usesOf(state.traitDraft.trait)} questions that use it.`);
  } else if (Array.isArray(draft.yes)) {
    yesLine.append(`Yes side: a fixed list of ${draft.yes.length} character${draft.yes.length === 1 ? '' : 's'}.`);
  } else if (trait) {
    yesLine.append('Yes side: trait ', el('code', '', trait), ` (used by ${usesOf(trait)} question${usesOf(trait) === 1 ? '' : 's'}).`);
    yesLine.append(button('Edit trait', () => startTraitEdit(trait)), button('Convert to list', convertYes));
  } else {
    yesLine.append('Yes side: characters matching ', el('code', '', JSON.stringify(draft.yes)), '.');
    yesLine.append(button('Convert to list', convertYes));
  }
  const definition = state.traitDraft?.trait ?? trait;
  if (definition) yesLine.append(el('span', 'definition', state.data.traits[definition].definition));

  const scopeLine = $('scope-summary');
  scopeLine.replaceChildren();
  if (!draft.scope) {
    scopeLine.append('Scope: none, so it can be asked of anyone.');
    scopeLine.append(button('Add a scope', () => update((d) => { d.scope = state.characters.map((c) => c.id); })));
  } else if (Array.isArray(draft.scope)) {
    scopeLine.append(`Scope: a fixed list of ${draft.scope.length} characters.`);
    scopeLine.append(button('Remove scope', removeScope));
  } else {
    scopeLine.append('Scope: characters matching ', el('code', '', JSON.stringify(draft.scope)), '.');
    scopeLine.append(button('Convert to list', () => update((d) => { d.scope = resolve(d.scope); })), button('Remove scope', removeScope));
  }

  // Edit-trait mode replaces "Save question" with "Save trait".
  $('save-trait').hidden = !state.traitDraft;
  if (state.traitDraft) $('save-trait').textContent = `Save trait ${state.traitDraft.trait} (affects ${usesOf(state.traitDraft.trait)} questions)`;
  $('save').disabled = Boolean(state.traitDraft);
  renderGrid();
}

function button(label, onClick) {
  const b = el('button', '', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function convertYes() {
  const draft = draftOf(state.current);
  const { yes } = sides(draft);
  update((d) => { d.yes = state.characters.map((c) => c.id).filter((id) => yes.has(id)); });
  $('notice').hidden = true;
}

function removeScope() {
  update((d) => { delete d.scope; });
}

function startTraitEdit(trait) {
  const yes = new Set(state.data.traits[trait].yes);
  state.traitDraft = { trait, yes, saved: new Set(yes) };
  state.mode = 'yes';
  document.querySelector('input[name="mode"][value="yes"]').checked = true;
  $('notice').hidden = true;
  renderEditor();
}

function notice(text, actions) {
  const box = $('notice');
  box.replaceChildren(el('p', '', text), ...actions.map(([label, fn]) => button(label, fn)), button('Cancel', () => { box.hidden = true; }));
  box.hidden = false;
}

function toggle(id) {
  const draft = draftOf(state.current);
  if (state.mode === 'scope') {
    if (!Array.isArray(draft.scope)) {
      notice(draft.scope
        ? 'This scope matches characters by their data. To change it for this question, convert it to a fixed list first.'
        : 'This question has no scope. Add one (starting with every character) to take characters out of it.',
      [[draft.scope ? 'Convert to list' : 'Add a scope', () => { update((d) => { d.scope = draft.scope ? resolve(d.scope) : state.characters.map((c) => c.id); }); $('notice').hidden = true; }]]);
      return;
    }
    update((d) => {
      d.scope = d.scope.includes(id) ? d.scope.filter((x) => x !== id) : state.characters.map((c) => c.id).filter((x) => x === id || d.scope.includes(x));
      // A fixed yes list can't reach outside the scope.
      if (Array.isArray(d.yes)) d.yes = d.yes.filter((x) => d.scope.includes(x));
    });
    return;
  }
  if (state.traitDraft) {
    const { yes } = state.traitDraft;
    if (yes.has(id)) yes.delete(id); else yes.add(id);
    renderEditor();
    return;
  }
  if (!Array.isArray(draft.yes)) {
    const trait = singleTrait(draft.yes);
    notice(trait
      ? `The yes side comes from the trait "${trait}", used by ${usesOf(trait)} questions. Change just this question (it becomes a fixed list), or edit the trait for every question that uses it?`
      : 'The yes side matches characters by their data. To change it for this question, convert it to a fixed list first.',
    trait ? [['Change just this question', convertYes], [`Edit trait ${trait}`, () => startTraitEdit(trait)]] : [['Convert to list', convertYes]]);
    return;
  }
  const scope = draft.scope ? new Set(resolve(draft.scope)) : null;
  if (scope && !scope.has(id)) {
    setStatus(`${nameOf(id)} is outside the scope; switch to editing the scope to include them.`, 'bad');
    return;
  }
  update((d) => {
    d.yes = d.yes.includes(id) ? d.yes.filter((x) => x !== id) : state.characters.map((c) => c.id).filter((x) => x === id || d.yes.includes(x));
  });
}

function renderGrid() {
  const draft = draftOf(state.current);
  const { scope, yes } = sides(draft);
  const savedYes = state.traitDraft ? state.traitDraft.saved : savedOf(state.current).yes;
  const filter = $('grid-filter').value.trim().toLowerCase();
  const inScope = scope ? scope.size : state.characters.length;
  const yesInScope = [...yes].filter((id) => !scope || scope.has(id)).length;
  const counts = $('split-counts');
  counts.replaceChildren(el('span', 'yes', `Yes ${yesInScope}`), ` · No ${inScope - yesInScope}`, scope ? ` · Out of scope ${state.characters.length - inScope}` : '');
  if (state.traitDraft) counts.append(` · In the trait overall ${yes.size}`);

  $('grid').replaceChildren(...TEAMS.map((team) => {
    const group = el('div', `team team-${team}`);
    group.append(el('h4', '', TEAM_LABEL[team]));
    const chips = el('div', 'chips');
    for (const c of state.characters.filter((x) => x.team === team).sort((a, b) => a.name.localeCompare(b.name))) {
      if (filter && !c.name.toLowerCase().includes(filter) && !c.id.includes(filter)) continue;
      const out = scope && !scope.has(c.id);
      const isYes = yes.has(c.id);
      const chip = el('button', `chip${isYes ? ' yes' : ''}${out ? ' out' : ''}${isYes !== savedYes.has(c.id) ? ' changed' : ''}`);
      chip.type = 'button';
      chip.title = `${c.name}: ${isYes ? 'yes' : out ? 'out of scope' : 'no'}`;
      chip.setAttribute('aria-pressed', String(isYes));
      const img = el('img');
      img.src = `/${c.image}`;
      img.alt = '';
      img.loading = 'lazy';
      chip.append(img, c.name);
      const show = () => { $('ability').textContent = `${c.name} (${team}): ${c.summary}`; };
      chip.addEventListener('mouseenter', show);
      chip.addEventListener('focus', show);
      chip.addEventListener('click', () => toggle(c.id));
      chips.append(chip);
    }
    group.append(chips);
    return group;
  }));
}

// ---- Checks and saving -----------------------------------------------------

let checkTimer = null;
let checkSeq = 0;
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(check, 300);
}

async function check() {
  const id = state.current;
  if (!id) return;
  const seq = ++checkSeq;
  const { body } = await api('/api/check', { file: savedOf(id).file, question: draftOf(id) });
  // Only the latest check counts; an older answer arriving late is dropped.
  if (seq !== checkSeq || id !== state.current) return;
  const issues = [...(body.errors ?? []).map((e) => ['error', e.replace(`Question ${id}: `, '').replace(`Question ${id} `, '')]), ...(body.warnings ?? []).map((w) => ['warning', `plain wording ${w}`])];
  $('issues').replaceChildren(...(issues.length ? issues.map(([kind, text]) => el('li', kind, text)) : [el('li', 'ok', 'Passes the validator')]));
  $('save').dataset.blocked = String(Boolean(body.errors?.length));
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

async function save() {
  const id = state.current;
  if (!id || state.traitDraft) return;
  if (!isDirty(id)) { setStatus('Nothing to save.'); return; }
  setStatus('Saving…');
  const { ok, body } = await api('/api/save', { file: savedOf(id).file, question: draftOf(id) });
  if (!ok) { setStatus(`Not saved: ${(body.errors ?? ['unknown error']).join('; ')}`, 'bad'); return; }
  state.drafts.delete(id);
  await load();
  open(id);
  setStatus(`Saved to data/questions/${savedOf(id).file}.`, 'good');
}

async function saveTrait() {
  const { trait, yes } = state.traitDraft;
  setStatus(`Saving trait ${trait} and rebuilding characters…`);
  const { ok, body } = await api('/api/trait', { trait, yes: [...yes] });
  if (!ok) { setStatus(`Not saved: ${(body.errors ?? ['unknown error']).join('; ')}`, 'bad'); return; }
  state.traitDraft = null;
  const id = state.current;
  await load();
  open(id);
  if (body.errors?.length) {
    setStatus(`Trait saved, but ${body.errors.length} question problem(s) now: see below.`, 'bad');
    showValidation(body.errors.join('\n'));
  } else {
    setStatus(`Trait ${trait} saved and characters rebuilt. Every question still passes.`, 'good');
  }
}

function showValidation(text) {
  $('validation').hidden = false;
  $('validation-output').textContent = text;
}

// ---- Wiring ----------------------------------------------------------------

for (const [field, key] of [['plain', 'plain'], ['styled', 'styled'], ['voice', 'voice']]) {
  $(field).addEventListener('input', () => update((d) => { d[key] = $(field).value; }));
}
for (const id of ['search', 'file-filter', 'character-filter', 'only-warnings', 'only-changed', 'only-unsaved']) $(id).addEventListener('input', renderBrowse);
$('grid-filter').addEventListener('input', renderGrid);
for (const radio of document.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', () => { state.mode = radio.value; $('notice').hidden = true; });
$('save').addEventListener('click', save);
$('save-trait').addEventListener('click', saveTrait);
$('revert').addEventListener('click', () => {
  state.drafts.delete(state.current);
  state.traitDraft = null;
  const id = state.current;
  state.current = null;
  open(id);
  renderCounts();
  setStatus('Changes discarded.');
});
$('validate').addEventListener('click', async () => {
  showValidation('Running node scripts/validate.js --verbose…');
  const { body } = await api('/api/validate', {});
  showValidation(`${body.code ? 'Problems found' : 'Passed'}\n\n${body.output}`);
});

for (const [tab, panel] of [['tab-browse', 'panel-browse'], ['tab-review', 'panel-review']]) {
  $(tab).addEventListener('click', () => {
    for (const [t, p] of [['tab-browse', 'panel-browse'], ['tab-review', 'panel-review']]) {
      $(t).setAttribute('aria-selected', String(t === tab));
      $(p).hidden = p !== panel;
    }
  });
}
$('review-load').addEventListener('click', () => {
  const ids = idsIn($('review-input').value);
  setQueue(ids);
  $('review-progress').textContent = ids.length ? `${ids.length} questions loaded. ${$('review-progress').textContent}` : 'No known question ids found in that text.';
});
$('review-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('review-input').value = await file.text();
  $('review-load').click();
  event.target.value = '';
});
$('review-clear').addEventListener('click', () => { setQueue([]); $('review-input').value = ''; });
$('review-prev').addEventListener('click', () => step(-1));
$('review-next').addEventListener('click', () => step(1));
$('reviewed').addEventListener('change', () => {
  if ($('reviewed').checked) state.reviewed.add(state.current); else state.reviewed.delete(state.current);
  saveReview();
  renderReview();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault();
    if (state.traitDraft) saveTrait(); else save();
  }
});
window.addEventListener('beforeunload', (event) => {
  if ([...state.drafts.keys()].some(isDirty) || traitDirty()) event.preventDefault();
});

loadReview();
await load();
const start = decodeURIComponent(location.hash.slice(1));
if (state.byId.has(start)) open(start);
