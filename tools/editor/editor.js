// Question editor client. The server (tools/editor/server.js) reads and writes
// the data files and checks every question save with the validator's own rules.
import { select } from '/js/engine.js';

const $ = (id) => document.getElementById(id);
const TEAMS = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'];
const TEAM_LABEL = { townsfolk: 'Townsfolk', outsider: 'Outsiders', minion: 'Minions', demon: 'Demons', traveller: 'Travellers' };
const REVIEW_KEY = 'question-editor-review';

const state = {
  data: null,
  characters: [],
  charById: new Map(),
  byId: new Map(), // question id -> { file, question (as saved), yes: Set, scope: Set | null }
  signatures: new Map(), // split signature -> [question ids]
  view: null, // { kind: 'question' | 'character' | 'trait', id }
  tab: 'questions',
  qDrafts: new Map(), // edited copies of saved questions
  newQuestions: new Map(), // id -> { file, draft } not yet saved
  history: new Map(), // question id -> { undo: [], redo: [] } for split changes
  cDrafts: new Map(), // character id -> { traits: Map(name -> state), quote, voice }
  tDrafts: new Map(), // trait name (or '' for a new one) -> draft
  mode: 'yes',
  review: { items: [] }, // from .cache/review-queue.json via the server
  listIds: { questions: [], review: [], characters: [], traits: [] },
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const strip = ({ _changed, _warnings, ...question }) => question;
const resolve = (selector) => (selector ? select(selector, state.characters) : null);
const allIds = () => state.characters.map((c) => c.id);
const nameOf = (id) => state.charById.get(id)?.name ?? id;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, onClick, className = '') => {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

async function api(path, payload) {
  const res = await fetch(path, payload === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

// ---- Loading -----------------------------------------------------------------

// Two questions split the same way when they cut the same scope into the same two groups.
function signature(yes, scope) {
  const pool = scope ? [...scope] : allIds();
  const inYes = pool.filter((id) => yes.has(id)).sort().join(',');
  const inNo = pool.filter((id) => !yes.has(id)).sort().join(',');
  return `${scope ? [...scope].sort().join(',') : '*'}|${inYes < inNo ? inYes : inNo}`;
}

function sidesOf(question) {
  const scope = question.scope ? new Set(resolve(question.scope)) : null;
  const yes = new Set((Array.isArray(question.yes) || question.yes ? resolve(question.yes) : []).filter((id) => !scope || scope.has(id)));
  return { yes, scope };
}

async function load() {
  const { body } = await api('/api/data');
  state.data = body;
  state.characters = body.characters;
  state.charById = new Map(body.characters.map((c) => [c.id, c]));
  state.byId = new Map();
  state.signatures = new Map();
  for (const { file, questions } of body.questionFiles) {
    for (const question of questions) {
      const { yes, scope } = sidesOf(question);
      state.byId.set(question.id, { file, question, yes, scope });
      const sig = signature(yes, scope);
      if (!state.signatures.has(sig)) state.signatures.set(sig, []);
      state.signatures.get(sig).push(question.id);
    }
  }
  $('voices').replaceChildren(...body.voices.map((v) => new Option(v)));
  if ($('file-filter').options.length === 1) {
    for (const file of body.files) $('file-filter').append(new Option(file, file));
    for (const c of [...state.characters].sort((a, b) => a.name.localeCompare(b.name))) $('character-filter').append(new Option(`Yes for ${c.name}`, c.id));
    for (const team of TEAMS) $('team-filter').append(new Option(TEAM_LABEL[team], team));
  }
  countUsage();
  renderCounts();
  renderLists();
}

const traitNames = () => Object.keys(state.data.traits).sort((a, b) => a.localeCompare(b));
// Which questions use each trait (in yes or scope, or its …Clear field), worked out once per load.
let usage = new Map();
function countUsage() {
  usage = new Map();
  for (const { question } of state.byId.values()) {
    const text = JSON.stringify([question.yes, question.scope ?? null]);
    for (const name of Object.keys(state.data.traits)) {
      if (text.includes(`"${name}"`) || text.includes(`"${name}Clear"`)) {
        if (!usage.has(name)) usage.set(name, []);
        usage.get(name).push(question.id);
      }
    }
  }
}
const questionsUsing = (trait) => usage.get(trait) ?? [];

// ---- Drafts ----------------------------------------------------------------

const qEntry = (id) => state.byId.get(id) ?? (state.newQuestions.has(id) ? { file: state.newQuestions.get(id).file, question: null, yes: new Set(), scope: null } : null);
function qDraft(id) {
  if (state.newQuestions.has(id)) return state.newQuestions.get(id).draft;
  return state.qDrafts.get(id) ?? clone(strip(state.byId.get(id).question));
}
function setQDraft(id, draft) {
  if (state.newQuestions.has(id)) state.newQuestions.get(id).draft = draft;
  else state.qDrafts.set(id, draft);
}
function qDirty(id) {
  if (state.newQuestions.has(id)) return true;
  return state.qDrafts.has(id) && JSON.stringify(state.qDrafts.get(id)) !== JSON.stringify(strip(state.byId.get(id).question));
}

function traitStateOf(trait, id) {
  if (trait.yes.includes(id)) return 'yes';
  if (Array.isArray(trait.no) && trait.no.includes(id)) return 'no';
  return Array.isArray(trait.no) ? 'unclear' : 'no';
}
function cDraft(id) {
  if (!state.cDrafts.has(id)) {
    const quote = state.data.quotes[id] ?? { quote: '', voice: '' };
    state.cDrafts.set(id, { traits: new Map(), quote: quote.quote, voice: quote.voice });
  }
  return state.cDrafts.get(id);
}
function cDirty(id) {
  const draft = state.cDrafts.get(id);
  if (!draft) return false;
  const saved = state.data.quotes[id] ?? { quote: '', voice: '' };
  const traitsChanged = [...draft.traits].some(([name, s]) => traitStateOf(state.data.traits[name], id) !== s);
  return traitsChanged || draft.quote !== saved.quote || draft.voice !== saved.voice;
}

function tDraft(name) {
  if (!state.tDrafts.has(name)) {
    const trait = state.data.traits[name];
    state.tDrafts.set(name, {
      name, file: trait.file, definition: trait.definition, create: false,
      yes: new Set(trait.yes), no: Array.isArray(trait.no) ? new Set(trait.no) : null,
    });
  }
  return state.tDrafts.get(name);
}
function tDirty(name) {
  const draft = state.tDrafts.get(name);
  if (!draft) return false;
  if (draft.create) return true;
  const trait = state.data.traits[name];
  const same = (a, b) => [...a].sort().join() === [...b].sort().join();
  return draft.definition !== trait.definition || !same(draft.yes, trait.yes)
    || Boolean(draft.no) !== Array.isArray(trait.no) || (draft.no && !same(draft.no, trait.no));
}

function anyDirty() {
  return [...state.byId.keys()].some(qDirty) || state.newQuestions.size > 0
    || [...state.cDrafts.keys()].some(cDirty) || [...state.tDrafts.keys()].some(tDirty);
}

function renderCounts() {
  const unsaved = [...state.byId.keys()].filter(qDirty).length + state.newQuestions.size
    + [...state.cDrafts.keys()].filter(cDirty).length + [...state.tDrafts.keys()].filter(tDirty).length;
  $('counts').textContent = `${state.byId.size} questions · ${state.characters.length} characters · ${traitNames().length} traits${unsaved ? ` · ${unsaved} unsaved` : ''}`;
}

// ---- Sidebar lists -------------------------------------------------------------

function questionItem(id, { done, reason } = {}) {
  const entry = qEntry(id);
  const li = el('li');
  if (!entry) {
    li.className = 'missing';
    li.textContent = `${id} (not found)`;
    return li;
  }
  if (done) li.classList.add('done');
  const marks = [];
  if (qDirty(id)) marks.push('● unsaved');
  if (entry.question?._warnings?.length) marks.push('⚠');
  if (entry.question?._changed) marks.push('Δ');
  li.append(el('span', 'marks', `${marks.join(' ')} ${entry.file.replace('.json', '')}`), el('span', 'id', id), document.createTextNode(qDraft(id).plain || '(no wording yet)'));
  if (reason) { const r = el('span', 'reason', reason); r.title = reason; li.append(r); }
  li.setAttribute('aria-current', String(state.view?.kind === 'question' && state.view.id === id));
  li.addEventListener('click', () => openQuestion(id));
  return li;
}

function renderQuestionList() {
  const words = $('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const file = $('file-filter').value;
  const character = $('character-filter').value;
  const ids = [...state.newQuestions.keys(), ...state.byId.keys()].filter((id) => {
    const entry = qEntry(id);
    if (file && entry.file !== file) return false;
    if (character && !entry.yes.has(character)) return false;
    if ($('only-warnings').checked && !entry.question?._warnings?.length) return false;
    if ($('only-changed').checked && !entry.question?._changed) return false;
    if ($('only-unsaved').checked && !qDirty(id)) return false;
    const draft = qDraft(id);
    const text = `${id} ${draft.plain} ${draft.styled}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  state.listIds.questions = ids;
  $('result-count').textContent = plural(ids.length, 'question');
  $('question-list').replaceChildren(...ids.map((id) => questionItem(id)));
}

function renderReviewList() {
  const items = state.review.items;
  const done = items.filter((i) => i.reviewed).length;
  const select = $('review-source');
  const sources = [...new Set(items.flatMap((i) => i.reasons.map((r) => r.source)).filter(Boolean))].sort();
  if ([...select.options].slice(1).map((o) => o.value).join() !== sources.join()) {
    const current = select.value;
    select.replaceChildren(new Option('From anyone', ''), ...sources.map((x) => new Option(`From ${x}`, x)));
    select.value = sources.includes(current) ? current : '';
  }
  const shown = items.filter((i) => (!$('review-hide-done').checked || !i.reviewed)
    && (!select.value || i.reasons.some((r) => r.source === select.value)));
  $('review-progress').textContent = items.length ? `${done} of ${items.length} reviewed` : 'The review list is empty.';
  $('review-badge').textContent = items.length - done ? String(items.length - done) : '';
  state.listIds.review = shown.map((i) => i.id);
  $('review-list').replaceChildren(...shown.map((i) => questionItem(i.id, {
    done: i.reviewed,
    reason: i.reviewed && i.resolution ? `Decided: ${i.resolution}` : i.reasons.map((r) => r.text).join(' · ') || '(no reason given)',
  })));
  renderReviewBox();
}

// The review box in the question editor: why it's on the list, and what was decided.
function renderReviewBox() {
  const id = state.view?.kind === 'question' && state.view.id;
  const item = id && reviewItem(id);
  $('review-box').hidden = !item;
  $('q-review-add').hidden = Boolean(item) || !id || state.newQuestions.has(id);
  if (!item) return;
  $('review-box').classList.toggle('done', item.reviewed);
  $('reviewed').checked = item.reviewed;
  if (document.activeElement !== $('review-resolution')) $('review-resolution').value = item.resolution;
  $('review-reasons').replaceChildren(...(item.reasons.length ? item.reasons.map((r, index) => {
    const li = el('li', '', r.text);
    li.append(' ', el('span', 'src', [r.source, r.added].filter(Boolean).join(', ')));
    const remove = button('✕', () => reviewChange('/api/review/update', { id: item.id, rev: item.rev, removeReason: r.text }), 'quiet');
    remove.title = 'Remove this reason';
    li.append(remove);
    return li;
  }) : [el('li', 'src', 'No reason given.')]));
}

function renderCharacterList() {
  const words = $('character-search').value.trim().toLowerCase();
  const team = $('team-filter').value;
  const list = [...state.characters]
    .filter((c) => (!team || c.team === team) && (!words || c.name.toLowerCase().includes(words) || c.id.includes(words)))
    .sort((a, b) => TEAMS.indexOf(a.team) - TEAMS.indexOf(b.team) || a.name.localeCompare(b.name));
  state.listIds.characters = list.map((c) => c.id);
  $('character-list').replaceChildren(...list.map((c) => {
    const li = el('li');
    const row = el('span', 'char-row');
    const img = el('img');
    img.src = `/${c.image}`;
    img.alt = '';
    img.loading = 'lazy';
    row.append(img, el('span', '', c.name), el('span', 'marks', `${cDirty(c.id) ? '● unsaved ' : ''}${TEAM_LABEL[c.team]}`));
    li.append(row);
    li.setAttribute('aria-current', String(state.view?.kind === 'character' && state.view.id === c.id));
    li.addEventListener('click', () => openCharacter(c.id));
    return li;
  }));
}

function renderTraitList() {
  const words = $('trait-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const names = [...(state.tDrafts.has('') ? [''] : []), ...traitNames()].filter((name) => {
    if (!name) return true;
    const text = `${name} ${state.data.traits[name].definition}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  state.listIds.traits = names;
  $('trait-list').replaceChildren(...names.map((name) => {
    const li = el('li');
    if (!name) {
      li.append(el('span', 'marks', '● new'), el('span', 'id', tDraft('').name || 'new trait'), document.createTextNode('Not saved yet'));
    } else {
      const trait = state.data.traits[name];
      li.append(
        el('span', 'marks', `${tDirty(name) ? '● unsaved ' : ''}${trait.yes.length} yes${trait.no ? ` · ${trait.no.length} no` : ''} · ${plural(questionsUsing(name).length, 'question')}`),
        el('span', 'id', name),
        document.createTextNode(trait.definition.length > 110 ? `${trait.definition.slice(0, 110)}…` : trait.definition),
      );
    }
    li.setAttribute('aria-current', String(state.view?.kind === 'trait' && state.view.id === name));
    li.addEventListener('click', () => openTrait(name));
    return li;
  }));
}

// After opening something, only the visible list needs redrawing.
function renderVisibleList() {
  if (state.tab === 'questions') renderQuestionList();
  if (state.tab === 'characters') renderCharacterList();
  if (state.tab === 'traits') renderTraitList();
  renderReviewList();
}

function renderLists() {
  renderQuestionList();
  renderReviewList();
  renderCharacterList();
  renderTraitList();
}

function showTab(tab) {
  const changed = state.tab !== tab;
  state.tab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
  if (changed && state.data) renderVisibleList();
}

// Alt+↑/↓ and the ◀ ▶ buttons move through the list in the open tab.
function step(delta) {
  const ids = state.listIds[state.tab];
  if (!ids.length) return;
  const at = ids.indexOf(state.view?.id);
  const next = ids[at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + delta))];
  if (state.tab === 'characters') openCharacter(next);
  else if (state.tab === 'traits') openTrait(next);
  else openQuestion(next);
}

// ---- Review list ---------------------------------------------------------------
// Kept by the server in .cache/review-queue.json, so agents and scripts can add to
// it too. The page never sends the whole list: each change goes as a single change,
// checked against the entry's revision, and the server answers with the fresh list.

const reviewItem = (id) => state.review.items.find((i) => i.id === id);

// Take the server's fresh list; report a refused change.
async function reviewChange(path, payload) {
  const { ok, body } = await api(path, payload);
  if (Array.isArray(body.items)) state.review = { items: body.items };
  renderReviewList();
  if (!ok) setStatus((body.errors ?? ['The review list could not be updated.']).join(' '), 'bad');
  return ok;
}

async function refreshReview() {
  const { body } = await api('/api/review');
  if (Array.isArray(body.items)) state.review = { items: body.items };
}

async function loadReview() {
  await refreshReview();
  // One-time move of a list this browser kept before reasons existed.
  try {
    const old = JSON.parse(localStorage.getItem(REVIEW_KEY));
    if (old?.queue?.length) {
      const entries = old.queue.filter((x) => !reviewItem(x)).map((id) => ({ id, text: 'Queued before review reasons were kept.', source: 'you' }));
      if (entries.length) await reviewChange('/api/review/add', { entries });
    }
    localStorage.removeItem(REVIEW_KEY);
  } catch {}
}

// Each line of the text: every known question id in it, with the rest of the line as its reason.
function entriesIn(text, fallback) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const ids = (line.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? []).filter((token) => state.byId.has(token));
    if (!ids.length) continue;
    let reason = line;
    for (const id of ids) reason = reason.replace(id, ' ');
    reason = reason.replace(/^[\s\-*•:|,.)(\][`"']+|[\s|`"',:;-]+$/g, '').replace(/\s+/g, ' ').trim();
    for (const id of ids) entries.push({ id, reason: reason || fallback });
  }
  return entries;
}

async function askForReason(id) {
  const answer = await ask({ title: `Why review ${id}?`, fields: [{ name: 'reason', label: 'Reason', type: 'textarea' }], ok: 'Add' });
  if (!answer) return;
  await reviewChange('/api/review/add', { entries: [{ id, text: answer.reason.trim() || 'No reason given.', source: 'you' }] });
}

// Removes entries, but only as they were when this page last saw them.
async function removeFromReview(items) {
  if (!items.length) return;
  const { ok, body } = await api('/api/review/remove', { items: items.map((i) => ({ id: i.id, rev: i.rev })) });
  if (Array.isArray(body.items)) state.review = { items: body.items };
  renderReviewList();
  if (ok && body.kept?.length) setStatus(`Kept ${plural(body.kept.length, 'entry', 'entries')} that changed elsewhere since this page loaded them: ${body.kept.join(', ')}.`, 'bad');
}

// ---- Views ---------------------------------------------------------------------

function show(kind) {
  $('empty').hidden = true;
  $('question-editor').hidden = kind !== 'question';
  $('character-editor').hidden = kind !== 'character';
  $('trait-editor').hidden = kind !== 'trait';
  $('actionbar').hidden = false;
  $('notice').hidden = true;
  setStatus('');
}

function setHash(kind, id) {
  history.replaceState(null, '', `#${kind[0]}=${encodeURIComponent(id)}`);
}

// ---- Question editor -----------------------------------------------------------

function openQuestion(id) {
  if (!qEntry(id)) return;
  // ◀ ▶ should step through questions, not the character or trait list it was opened from.
  if (state.tab === 'characters' || state.tab === 'traits') showTab('questions');
  state.view = { kind: 'question', id };
  setHash('question', id);
  show('question');
  const draft = qDraft(id);
  $('plain').value = draft.plain ?? '';
  $('styled').value = draft.styled ?? '';
  $('voice').value = draft.voice ?? '';
  $('option-yes').value = draft.options?.[0] ?? '';
  $('option-no').value = draft.options?.[1] ?? '';
  renderQuestion();
  renderVisibleList();
  check();
}

function updateQuestion(change, { snapshot = false } = {}) {
  const id = state.view.id;
  const draft = qDraft(id);
  if (snapshot) {
    const h = state.history.get(id) ?? { undo: [], redo: [] };
    h.undo.push(JSON.stringify(draft));
    h.redo = [];
    state.history.set(id, h);
  }
  change(draft);
  setQDraft(id, draft);
  renderQuestion();
  renderCounts();
  scheduleCheck();
}

function undoRedo(from, to) {
  const id = state.view?.kind === 'question' && state.view.id;
  const h = id && state.history.get(id);
  if (!h || !h[from].length) return;
  h[to].push(JSON.stringify(qDraft(id)));
  setQDraft(id, JSON.parse(h[from].pop()));
  openQuestion(id);
}

// A selector that is exactly one trait set to true, like { "killsByDay": true }.
function singleTrait(selector) {
  if (!selector || Array.isArray(selector)) return null;
  const entries = Object.entries(selector);
  return entries.length === 1 && entries[0][1] === true && state.data.traits[entries[0][0]] ? entries[0][0] : null;
}

function renderQuestion() {
  const id = state.view.id;
  const draft = qDraft(id);
  const entry = qEntry(id);
  const isNew = state.newQuestions.has(id);
  $('q-id').textContent = id;
  $('q-file').textContent = entry.file;
  $('q-new').hidden = !isNew;
  $('q-dirty').hidden = isNew || !qDirty(id);
  $('q-changed').hidden = !entry.question?._changed;
  for (const b of ['q-rename', 'q-delete']) $(b).disabled = isNew;
  $('save').textContent = isNew ? 'Create question' : 'Save question';
  const h = state.history.get(id);
  $('undo').disabled = !h?.undo.length;
  $('redo').disabled = !h?.redo.length;
  $('plain-count').textContent = plural((draft.plain ?? '').trim().split(/\s+/).filter(Boolean).length, 'word');

  // Previews of what players see.
  $('preview-plain').textContent = draft.plain || '…';
  $('preview-id').textContent = id;
  $('preview-styled').textContent = draft.styled || '…';
  $('preview-yes').textContent = draft.options?.[0] || 'Yes';
  $('preview-no').textContent = draft.options?.[1] || 'No';

  // Where the yes side and scope come from.
  const trait = singleTrait(draft.yes);
  const yesLine = $('yes-summary');
  yesLine.replaceChildren();
  if (Array.isArray(draft.yes)) {
    yesLine.append(`Yes side: a fixed list of ${plural(draft.yes.length, 'character')}.`);
  } else if (trait) {
    yesLine.append('Yes side: the trait ', el('code', '', trait), ` (used by ${plural(questionsUsing(trait).length, 'question')}).`);
    yesLine.append(button('Open trait', () => openTrait(trait)), button('Change just this question', convertYes));
    yesLine.append(conditionChips('yes'));
    yesLine.append(el('span', 'definition', state.data.traits[trait].definition));
  } else {
    yesLine.append('Yes side: characters matching all of ', conditionChips('yes'));
    yesLine.append(button('Make it a fixed list', convertYes));
  }
  const scopeLine = $('scope-summary');
  scopeLine.replaceChildren();
  if (!draft.scope) {
    scopeLine.append('Scope: none, so it can be asked of anyone.');
    scopeLine.append(button('Add a scope (fixed list)', () => updateQuestion((d) => { d.scope = allIds(); }, { snapshot: true })), button('Add a scope condition', () => addCondition('scope')));
  } else if (Array.isArray(draft.scope)) {
    scopeLine.append(`Scope: a fixed list of ${plural(draft.scope.length, 'character')}. It's only asked once every remaining character is inside it.`);
    scopeLine.append(button('Remove scope', () => updateQuestion((d) => { delete d.scope; }, { snapshot: true })));
  } else {
    scopeLine.append('Scope: characters matching all of ', conditionChips('scope'));
    scopeLine.append(button('Make it a fixed list', () => updateQuestion((d) => { d.scope = resolve(d.scope); }, { snapshot: true })), button('Remove scope', () => updateQuestion((d) => { delete d.scope; }, { snapshot: true })));
  }

  // Other questions that split the same way.
  const { yes, scope } = sidesOf(draft);
  const same = (state.signatures.get(signature(yes, scope)) ?? []).filter((other) => other !== id);
  $('same-split').hidden = !same.length;
  if (same.length) {
    $('same-split').replaceChildren('Splits exactly like ', ...same.flatMap((other, i) => {
      const a = el('a', '', other);
      a.addEventListener('click', () => openQuestion(other));
      return i ? [', ', a] : [a];
    }), '. That\'s allowed, but a different split teaches the game more.');
  }

  renderQuestionGrid();
}

// A condition-based selector's conditions ("field: value"), each removable, plus "+ condition".
function conditionChips(kind) {
  const selector = qDraft(state.view.id)[kind];
  const wrap = el('span', 'conditions');
  for (const [field, value] of Object.entries(selector)) {
    const chip = el('span', 'condition');
    chip.append(el('code', '', `${field}: ${Array.isArray(value) ? value.join(' or ') : value}`));
    if (state.data.traits[field.replace(/Clear$/, '')]) chip.title = state.data.traits[field.replace(/Clear$/, '')].definition;
    if (field === 'abilityVaries') chip.title = 'Keeps out the eight characters whose ability varies (Philosopher, Cannibal, Pixie, Apprentice, Alchemist, Hermit, Amnesiac, Wizard).';
    const remove = button('✕', () => updateQuestion((d) => {
      delete d[kind][field];
      if (!Object.keys(d[kind]).length) { if (kind === 'scope') delete d.scope; else d.yes = []; }
    }, { snapshot: true }), 'quiet');
    remove.title = `Remove the ${field} condition`;
    chip.append(remove);
    wrap.append(chip);
  }
  wrap.append(button('+ condition', () => addCondition(kind), 'quiet'));
  return wrap;
}

async function addCondition(kind) {
  const skip = new Set(['id', 'name', 'summary', 'image']);
  const fields = Object.keys(state.characters[0]).filter((k) => !skip.has(k)).sort((a, b) => a.localeCompare(b));
  const answer = await ask({
    title: `Add a condition to the ${kind === 'scope' ? 'scope' : 'yes side'}`,
    text: 'Characters must match every condition. For a trait or other yes/no field, type true or false. For team or edition, type one value or several separated by commas (any of them matches).',
    fields: [{ name: 'field', label: 'Field', type: 'select', options: fields }, { name: 'value', label: 'Value', value: 'true' }],
    ok: 'Add condition',
  });
  if (!answer) return;
  const sample = state.characters.find((c) => answer.field in c)?.[answer.field];
  let value;
  if (typeof sample === 'boolean') {
    if (!/^(true|false)$/i.test(answer.value.trim())) { setStatus(`Use true or false for ${answer.field}.`, 'bad'); return; }
    value = /^true$/i.test(answer.value.trim());
  } else {
    const parts = answer.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) { setStatus('Give a value.', 'bad'); return; }
    value = parts.length === 1 ? parts[0] : parts;
  }
  updateQuestion((d) => {
    const current = d[kind];
    d[kind] = { ...(current && !Array.isArray(current) ? current : {}), [answer.field]: value };
  }, { snapshot: true });
}

function convertYes() {
  updateQuestion((d) => {
    const { yes } = sidesOf(d);
    d.yes = allIds().filter((x) => yes.has(x));
  }, { snapshot: true });
  $('notice').hidden = true;
}

function notice(text, actions) {
  const box = $('notice');
  box.replaceChildren(el('p', '', text), ...actions.map(([label, fn]) => button(label, () => { box.hidden = true; fn(); })), button('Cancel', () => { box.hidden = true; }, 'quiet'));
  box.hidden = false;
}

function toggleQuestionCharacter(id) {
  const draft = qDraft(state.view.id);
  if (state.mode === 'scope') {
    if (!Array.isArray(draft.scope)) {
      notice(draft.scope
        ? 'This scope matches characters by their data. To pick characters by hand, make it a fixed list first.'
        : 'This question has no scope. Add one (starting with every character), then click characters to take them out.',
      [[draft.scope ? 'Make it a fixed list' : 'Add a scope', () => updateQuestion((d) => { d.scope = d.scope ? resolve(d.scope) : allIds(); }, { snapshot: true })]]);
      return;
    }
    updateQuestion((d) => {
      d.scope = d.scope.includes(id) ? d.scope.filter((x) => x !== id) : allIds().filter((x) => x === id || d.scope.includes(x));
      // A fixed yes list can't reach outside the scope.
      if (Array.isArray(d.yes)) d.yes = d.yes.filter((x) => d.scope.includes(x));
    }, { snapshot: true });
    return;
  }
  if (!Array.isArray(draft.yes)) {
    const trait = singleTrait(draft.yes);
    notice(trait
      ? `The yes side comes from the trait "${trait}", which ${plural(questionsUsing(trait).length, 'question')} use. Change just this question (its yes side becomes a fixed list), or open the trait to change it everywhere?`
      : 'The yes side matches characters by their data. To pick characters by hand, change it to a fixed list for this question.',
    trait ? [['Change just this question', () => { convertYes(); toggleQuestionCharacter(id); }], [`Open trait ${trait}`, () => openTrait(trait)]]
      : [['Change just this question', () => { convertYes(); toggleQuestionCharacter(id); }]]);
    return;
  }
  const scope = draft.scope ? new Set(resolve(draft.scope)) : null;
  if (scope && !scope.has(id)) {
    setStatus(`${nameOf(id)} is outside the scope. Switch to "Scope" to bring them in first.`, 'bad');
    return;
  }
  updateQuestion((d) => {
    d.yes = d.yes.includes(id) ? d.yes.filter((x) => x !== id) : allIds().filter((x) => x === id || d.yes.includes(x));
  }, { snapshot: true });
}

// Shared character grid: stateOf(id) -> 'yes' | 'no' | 'no-list' | 'out'.
function renderGrid(container, { stateOf, changed, onClick, filter, abilityEl }) {
  const words = filter.trim().toLowerCase();
  container.replaceChildren(...TEAMS.map((team) => {
    const group = el('div', `team team-${team}`);
    group.append(el('h4', '', TEAM_LABEL[team]));
    const chips = el('div', 'chips');
    for (const c of state.characters.filter((x) => x.team === team).sort((a, b) => a.name.localeCompare(b.name))) {
      if (words && !c.name.toLowerCase().includes(words) && !c.id.includes(words)) continue;
      const s = stateOf(c.id);
      const chip = el('button', `chip ${s === 'no' ? '' : s}${changed(c.id) ? ' changed' : ''}`);
      chip.type = 'button';
      chip.title = `${c.name}: ${s === 'out' ? 'out of scope' : s === 'no-list' ? 'no' : s === 'unclear' ? 'unclear' : s}`;
      chip.setAttribute('aria-pressed', String(s === 'yes'));
      const img = el('img');
      img.src = `/${c.image}`;
      img.alt = '';
      img.loading = 'lazy';
      chip.append(img, c.name);
      const showAbility = () => { abilityEl.textContent = `${c.name} (${team}): ${c.summary}`; };
      chip.addEventListener('mouseenter', showAbility);
      chip.addEventListener('focus', showAbility);
      chip.addEventListener('click', () => onClick(c.id));
      chips.append(chip);
    }
    group.append(chips);
    return group;
  }));
}

function teamBreakdown(ids) {
  const counts = TEAMS.map((team) => [team, ids.filter((id) => state.charById.get(id)?.team === team).length]).filter(([, n]) => n);
  return counts.map(([team, n]) => `${n} ${n === 1 ? TEAM_LABEL[team].replace(/s$/, '') : TEAM_LABEL[team]}`).join(', ');
}

function renderQuestionGrid() {
  const id = state.view.id;
  const draft = qDraft(id);
  const { yes, scope } = sidesOf(draft);
  const saved = qEntry(id);
  const pool = scope ? [...scope] : allIds();
  const yesIds = pool.filter((x) => yes.has(x));
  const noIds = pool.filter((x) => !yes.has(x));
  const counts = $('split-counts');
  counts.replaceChildren(
    el('strong', 'yes', `Yes ${yesIds.length}`), el('span', 'teams', teamBreakdown(yesIds)),
    el('strong', 'no', `No ${noIds.length}`), el('span', 'teams', noIds.length > 40 ? 'everyone else' : teamBreakdown(noIds)),
  );
  if (scope) counts.append(el('span', 'teams', `Out of scope: ${state.characters.length - scope.size}`));
  renderGrid($('grid'), {
    stateOf: (x) => (scope && !scope.has(x) ? 'out' : yes.has(x) ? 'yes' : 'no'),
    changed: (x) => (state.newQuestions.has(id) ? false : yes.has(x) !== saved.yes.has(x) || (scope?.has(x) ?? true) !== (saved.scope?.has(x) ?? true)),
    onClick: toggleQuestionCharacter,
    filter: $('grid-filter').value,
    abilityEl: $('ability'),
  });
}

let checkTimer = null;
let checkSeq = 0;
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(check, 300);
}
async function check() {
  if (state.view?.kind !== 'question') return;
  const id = state.view.id;
  const seq = ++checkSeq;
  const { body } = await api('/api/check', { question: qDraft(id) });
  // Only the latest check counts; an older answer arriving late is dropped.
  if (seq !== checkSeq || state.view?.id !== id) return;
  const issues = [
    ...(body.errors ?? []).map((e) => ['error', e.replace(`Question ${id}: `, '').replace(`Question ${id} `, '')]),
    ...(body.warnings ?? []).map((w) => ['warning', `plain wording ${w}`]),
  ];
  const styled = qDraft(id).styled ?? '';
  if (styled && !styled.trim().endsWith('?')) issues.push(['warning', 'the styled line should end with the same yes/no question as the plain one']);
  $('issues').replaceChildren(...(issues.length ? issues.map(([kind, text]) => el('li', kind, text)) : [el('li', 'ok', 'Passes the validator')]));
}

async function saveQuestion() {
  const id = state.view.id;
  const isNew = state.newQuestions.has(id);
  if (!isNew && !qDirty(id)) { setStatus('Nothing to save.'); return; }
  setStatus('Saving…');
  const { ok, body } = await api('/api/save', { file: qEntry(id).file, question: qDraft(id), create: isNew });
  if (!ok) { setStatus(`Not saved: ${(body.errors ?? ['unknown error']).map((e) => e.replace(`Question ${id}: `, '')).join('; ')}`, 'bad'); return; }
  state.newQuestions.delete(id);
  state.qDrafts.delete(id);
  await refreshReview();
  await load();
  openQuestion(id);
  setStatus(isNew ? `Created in data/questions/${qEntry(id).file}.` : `Saved to data/questions/${qEntry(id).file}.`, 'good');
}

// ---- Dialogs --------------------------------------------------------------------

// A small form in a modal dialog. fields: [{ name, label, value, type: 'text' | 'textarea' | 'select', options }].
function ask({ title, text, fields = [], ok = 'OK', danger = false }) {
  return new Promise((resolveAnswer) => {
    const dialog = $('dialog');
    $('dialog-title').textContent = title;
    const body = $('dialog-body');
    body.replaceChildren();
    if (text) body.append(el('p', '', text));
    const inputs = {};
    for (const field of fields) {
      const label = el('label', 'field', field.label);
      let input;
      if (field.type === 'select') {
        input = el('select');
        for (const option of field.options) input.append(new Option(option.label ?? option, option.value ?? option));
      } else {
        input = el(field.type === 'textarea' ? 'textarea' : 'input');
        if (field.type === 'textarea') input.rows = 5;
        else input.type = 'text';
      }
      input.value = field.value ?? '';
      if (field.onInput) input.addEventListener('input', () => field.onInput(input, inputs));
      inputs[field.name] = input;
      label.append(input);
      body.append(label);
    }
    $('dialog-ok').textContent = ok;
    $('dialog-ok').className = danger ? 'primary danger' : 'primary';
    const finish = (answer) => {
      dialog.close();
      resolveAnswer(answer);
    };
    $('dialog-form').onsubmit = (event) => {
      event.preventDefault();
      finish(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value])));
    };
    $('dialog-cancel').onclick = () => finish(null);
    dialog.oncancel = () => resolveAnswer(null);
    dialog.showModal();
    (Object.values(inputs)[0] ?? $('dialog-ok')).focus();
  });
}

const prefixOf = (file) => {
  const counts = new Map();
  for (const { file: f, question } of state.byId.values()) if (f === file) counts.set(question.id.split('-')[0], (counts.get(question.id.split('-')[0]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? file.replace('.json', '');
};
const idProblem = (id) => (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id) ? 'Use lower-case words joined by hyphens, like tfc-quiet-nights.'
  : state.byId.has(id) || state.newQuestions.has(id) ? 'That id is already taken.' : '');

async function newQuestion(copyFrom = null) {
  const file = copyFrom ? qEntry(copyFrom).file : $('file-filter').value || state.data.files[0];
  const answer = await ask({
    title: copyFrom ? `Duplicate ${copyFrom}` : 'New question',
    text: copyFrom ? 'The copy starts with the same wording and split. Change the wording before saving: two questions can\'t share the same text.' : 'Pick its file and a short, descriptive id. The id is permanent once players have seen it.',
    fields: [
      { name: 'file', label: 'File', type: 'select', options: state.data.files, value: file,
        onInput: (input, inputs) => { if (!inputs.id.dataset.touched) inputs.id.value = `${prefixOf(input.value)}-`; } },
      { name: 'id', label: 'Id', value: copyFrom ? `${copyFrom}-2` : `${prefixOf(file)}-`, onInput: (input) => { input.dataset.touched = '1'; } },
    ],
    ok: copyFrom ? 'Duplicate' : 'Create draft',
  });
  if (!answer) return;
  const id = answer.id.trim();
  const problem = idProblem(id);
  if (problem) { setStatus(problem, 'bad'); return; }
  const draft = copyFrom ? { ...clone(qDraft(copyFrom)), id } : { id, plain: '', styled: '', voice: '', yes: [] };
  state.newQuestions.set(id, { file: answer.file, draft });
  showTab('questions');
  openQuestion(id);
  setStatus('Draft created. It\'s saved to the file when you press Create question.', 'good');
}

async function renameQuestion() {
  const id = state.view.id;
  if (qDirty(id)) { setStatus('Save or discard your changes before renaming.', 'bad'); return; }
  const answer = await ask({
    title: `Rename ${id}`,
    text: 'Saved hunts refer to questions by id, so anyone mid-hunt who already asked this question will have their progress reset. Rename only if the id is wrong.',
    fields: [{ name: 'id', label: 'New id', value: id }],
    ok: 'Rename',
  });
  if (!answer || answer.id.trim() === id) return;
  const newId = answer.id.trim();
  const problem = idProblem(newId);
  if (problem) { setStatus(problem, 'bad'); return; }
  const { ok, body } = await api('/api/rename', { file: qEntry(id).file, id, newId });
  if (!ok) { setStatus(`Not renamed: ${body.errors.join('; ')}`, 'bad'); return; }
  await refreshReview();
  state.history.delete(id);
  await load();
  openQuestion(newId);
  setStatus(`Renamed to ${newId}.`, 'good');
}

async function deleteQuestion() {
  const id = state.view.id;
  const answer = await ask({ title: `Delete ${id}?`, text: 'It\'s removed from the file straight away. Git still has it if you need it back.', ok: 'Delete', danger: true });
  if (!answer) return;
  const ids = state.listIds[state.tab];
  const next = ids[ids.indexOf(id) + 1] ?? ids[ids.indexOf(id) - 1];
  const { ok, body } = await api('/api/delete', { file: qEntry(id).file, id });
  if (!ok) { setStatus(`Not deleted: ${body.errors.join('; ')}`, 'bad'); return; }
  state.qDrafts.delete(id);
  await load();
  if (next && qEntry(next)) openQuestion(next);
  setStatus(`Deleted ${id}.`, 'good');
}

async function pasteNames() {
  const draft = qDraft(state.view.id);
  const answer = await ask({
    title: 'Set the yes side from names',
    text: 'Paste character names or ids, separated by commas or new lines. They replace the current yes side (as a fixed list).',
    fields: [{ name: 'names', label: 'Characters', type: 'textarea', value: [...sidesOf(draft).yes].map(nameOf).join(', ') }],
    ok: 'Set yes side',
  });
  if (!answer) return;
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byKey = new Map(state.characters.flatMap((c) => [[key(c.name), c.id], [key(c.id), c.id]]));
  const picked = [];
  const unknown = [];
  for (const part of answer.names.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean)) {
    const id = byKey.get(key(part));
    if (id) picked.push(id); else unknown.push(part);
  }
  const scope = draft.scope ? new Set(resolve(draft.scope)) : null;
  const outside = picked.filter((x) => scope && !scope.has(x));
  updateQuestion((d) => { d.yes = allIds().filter((x) => picked.includes(x) && (!scope || scope.has(x))); }, { snapshot: true });
  const notes = [unknown.length ? `not recognised: ${unknown.join(', ')}` : '', outside.length ? `outside the scope, left out: ${outside.map(nameOf).join(', ')}` : ''].filter(Boolean);
  setStatus(notes.length ? `Yes side set; ${notes.join('; ')}.` : `Yes side set to ${plural(picked.length, 'character')}.`, notes.length ? 'bad' : 'good');
}

// ---- Character editor ---------------------------------------------------------

function openCharacter(id) {
  showTab('characters');
  state.view = { kind: 'character', id };
  setHash('character', id);
  show('character');
  const c = state.charById.get(id);
  const draft = cDraft(id);
  $('c-art').src = `/${c.image}`;
  $('c-name').textContent = c.name;
  $('c-meta').textContent = `${TEAM_LABEL[c.team].replace(/s$/, '')} · ${c.edition}`;
  $('c-summary').textContent = c.summary;
  $('c-quote').value = draft.quote;
  $('c-voice').value = draft.voice;
  $('save').textContent = 'Save character';
  renderCharacter();
  renderVisibleList();
}

function renderCharacter() {
  const id = state.view.id;
  const draft = cDraft(id);
  $('c-dirty').hidden = !cDirty(id);
  const words = $('c-trait-filter').value.trim().toLowerCase();
  const onlyYes = $('c-only-yes').checked;
  const rows = traitNames().filter((name) => {
    const trait = state.data.traits[name];
    const current = draft.traits.get(name) ?? traitStateOf(trait, id);
    if (onlyYes && current !== 'yes') return false;
    return !words || `${name} ${trait.definition}`.toLowerCase().includes(words);
  });
  $('c-traits').replaceChildren(...rows.map((name) => {
    const trait = state.data.traits[name];
    const saved = traitStateOf(trait, id);
    const current = draft.traits.get(name) ?? saved;
    const li = el('li', current !== saved ? 'changed' : '');
    const control = el('span', 'state');
    for (const option of Array.isArray(trait.no) ? ['yes', 'no', 'unclear'] : ['yes', 'no']) {
      const b = button(option[0].toUpperCase() + option.slice(1), () => {
        if (option === saved) draft.traits.delete(name); else draft.traits.set(name, option);
        renderCharacter();
        renderCounts();
      }, `s-${option}`);
      b.setAttribute('aria-pressed', String(current === option));
      control.append(b);
    }
    li.append(el('code', '', name), control, el('span', 'tdef', trait.definition));
    return li;
  }));
  const yesQuestions = [...state.byId.values()].filter((e) => e.yes.has(id)).map((e) => e.question.id);
  $('c-question-count').textContent = `(answers yes to ${plural(yesQuestions.length, 'question')})`;
  $('c-questions').replaceChildren(...yesQuestions.map((qid) => {
    const li = el('li');
    const a = el('a', '', qEntry(qid).question.plain);
    a.addEventListener('click', () => openQuestion(qid));
    li.append(a, ' ', el('span', 'id', qid));
    return li;
  }));
}

async function saveCharacter() {
  const id = state.view.id;
  if (!cDirty(id)) { setStatus('Nothing to save.'); return; }
  const draft = cDraft(id);
  const saved = state.data.quotes[id] ?? { quote: '', voice: '' };
  const traits = Object.fromEntries([...draft.traits].filter(([name, s]) => traitStateOf(state.data.traits[name], id) !== s));
  const quoteChanged = draft.quote !== saved.quote || draft.voice !== saved.voice;
  setStatus(Object.keys(traits).length ? 'Saving and rebuilding characters…' : 'Saving…');
  const { ok, body } = await api('/api/character', { id, traits, quote: quoteChanged ? { quote: draft.quote, voice: draft.voice } : null });
  if (!ok) { setStatus(`Not saved: ${(body.errors ?? ['unknown error']).join('; ')}`, 'bad'); return; }
  state.cDrafts.delete(id);
  await load();
  openCharacter(id);
  reportAfterTraitSave(body.errors, `${nameOf(id)} saved.`);
}

function reportAfterTraitSave(errors, message) {
  if (errors?.length) {
    setStatus(`${message} But ${plural(errors.length, 'question problem')} now: see below.`, 'bad');
    showValidation(errors.join('\n'));
  } else {
    setStatus(`${message} Every question still passes.`, 'good');
  }
}

// ---- Trait editor ----------------------------------------------------------------

function openTrait(name) {
  state.view = { kind: 'trait', id: name };
  if (name) setHash('trait', name);
  show('trait');
  const draft = tDraft(name);
  $('t-title').textContent = name || 'New trait';
  $('t-file').textContent = draft.file;
  $('t-file').hidden = draft.create;
  $('t-new-fields').hidden = !draft.create;
  $('t-name').value = draft.name;
  $('t-file-select').replaceChildren(...state.data.traitFiles.map((f) => new Option(f, f)));
  $('t-file-select').value = draft.file;
  $('t-definition').value = draft.definition;
  $('t-subjective').checked = Boolean(draft.no);
  $('save').textContent = draft.create ? 'Create trait' : 'Save trait';
  showTab('traits');
  renderTrait();
  renderVisibleList();
}

function renderTrait() {
  const name = state.view.id;
  const draft = tDraft(name);
  const saved = state.data.traits[name];
  $('t-dirty').hidden = draft.create || !tDirty(name);
  $('t-help').textContent = draft.no
    ? 'Click a character to cycle it through yes, no and unclear. Unclear characters are on neither list; questions can leave them out with a scope on the …Clear field.'
    : 'Click a character to put it on or off the yes list. Everyone not on it is a no.';
  const stateOf = (id) => (draft.yes.has(id) ? 'yes' : draft.no?.has(id) ? 'no-list' : draft.no ? 'unclear' : 'no');
  const savedStateOf = (id) => (!saved ? 'no' : saved.yes.includes(id) ? 'yes' : saved.no?.includes(id) ? 'no-list' : saved.no ? 'unclear' : 'no');
  const ids = allIds();
  const counts = $('t-counts');
  counts.replaceChildren(el('strong', 'yes', `Yes ${draft.yes.size}`), el('span', 'teams', teamBreakdown([...draft.yes])));
  if (draft.no) counts.append(el('strong', 'no', `No ${draft.no.size}`), el('span', 'teams', `Unclear ${ids.length - draft.yes.size - draft.no.size}`));
  renderGrid($('t-grid'), {
    stateOf,
    changed: (id) => !draft.create && stateOf(id) !== savedStateOf(id),
    onClick: (id) => {
      const s = stateOf(id);
      draft.yes.delete(id);
      draft.no?.delete(id);
      if (draft.no) {
        if (s === 'unclear') draft.yes.add(id);
        else if (s === 'yes') draft.no.add(id);
      } else if (s !== 'yes') {
        draft.yes.add(id);
      }
      renderTrait();
      renderCounts();
    },
    filter: $('t-grid-filter').value,
    abilityEl: $('t-ability'),
  });
  const users = name ? questionsUsing(name) : [];
  $('t-use-count').textContent = `(${users.length})`;
  $('t-delete').disabled = draft.create || users.length > 0;
  $('t-delete').title = users.length ? 'Only a trait no question uses can be deleted.' : '';
  $('t-questions').replaceChildren(...users.map((qid) => {
    const li = el('li');
    const a = el('a', '', qEntry(qid).question.plain);
    a.addEventListener('click', () => openQuestion(qid));
    li.append(a, ' ', el('span', 'id', qid));
    return li;
  }));
}

async function deleteTrait() {
  const name = state.view.id;
  const answer = await ask({ title: `Delete trait ${name}?`, text: 'It is removed from its file and characters are rebuilt. Git still has it if you need it back.', ok: 'Delete', danger: true });
  if (!answer) return;
  const { ok, body } = await api('/api/trait/delete', { name });
  if (!ok) { setStatus(`Not deleted: ${body.errors.join('; ')}`, 'bad'); return; }
  state.tDrafts.delete(name);
  await load();
  $('trait-editor').hidden = true;
  $('actionbar').hidden = true;
  $('empty').hidden = false;
  state.view = null;
  renderLists();
  setStatus('');
}

function newTrait() {
  state.tDrafts.set('', { name: '', file: state.data.traitFiles[0], definition: '', create: true, yes: new Set(), no: null });
  openTrait('');
}

async function saveTrait() {
  const key = state.view.id;
  const draft = tDraft(key);
  if (!draft.create && !tDirty(key)) { setStatus('Nothing to save.'); return; }
  setStatus('Saving and rebuilding characters…');
  const { ok, body } = await api('/api/trait', {
    name: draft.name, file: draft.file, definition: draft.definition, create: draft.create,
    yes: [...draft.yes], no: draft.no ? [...draft.no] : null,
  });
  if (!ok) { setStatus(`Not saved: ${(body.errors ?? ['unknown error']).join('; ')}`, 'bad'); return; }
  state.tDrafts.delete(key);
  await load();
  openTrait(draft.name);
  reportAfterTraitSave(body.errors, `Trait ${draft.name} ${draft.create ? 'created' : 'saved'} and characters rebuilt.`);
}

// ---- Save, discard, validation --------------------------------------------------

function save() {
  if (state.view?.kind === 'question') return saveQuestion();
  if (state.view?.kind === 'character') return saveCharacter();
  if (state.view?.kind === 'trait') return saveTrait();
}

function discard() {
  const { kind, id } = state.view ?? {};
  if (kind === 'question') {
    if (state.newQuestions.has(id)) {
      state.newQuestions.delete(id);
      renderLists();
      renderCounts();
      $('question-editor').hidden = true;
      $('actionbar').hidden = true;
      $('empty').hidden = false;
      return;
    }
    state.qDrafts.delete(id);
    state.history.delete(id);
    openQuestion(id);
  } else if (kind === 'character') {
    state.cDrafts.delete(id);
    openCharacter(id);
  } else if (kind === 'trait') {
    state.tDrafts.delete(id);
    if (id) openTrait(id); else { renderLists(); $('trait-editor').hidden = true; $('actionbar').hidden = true; $('empty').hidden = false; }
  }
  renderCounts();
  setStatus('Changes discarded.');
}

function showValidation(text) {
  $('validation').hidden = false;
  $('validation-output').textContent = text;
}

// ---- Wiring --------------------------------------------------------------------

for (const [field, apply] of [
  ['plain', (d, v) => { d.plain = v; }],
  ['styled', (d, v) => { d.styled = v; }],
  ['voice', (d, v) => { d.voice = v; }],
]) $(field).addEventListener('input', () => updateQuestion((d) => apply(d, $(field).value)));
for (const field of ['option-yes', 'option-no']) {
  $(field).addEventListener('input', () => updateQuestion((d) => {
    const labels = [$('option-yes').value.trim(), $('option-no').value.trim()];
    if (labels.some(Boolean)) d.options = [labels[0] || 'Yes', labels[1] || 'No']; else delete d.options;
  }));
}
for (const id of ['search', 'file-filter', 'character-filter', 'only-warnings', 'only-changed', 'only-unsaved']) $(id).addEventListener('input', renderQuestionList);
for (const id of ['character-search', 'team-filter']) $(id).addEventListener('input', renderCharacterList);
$('trait-search').addEventListener('input', renderTraitList);
$('grid-filter').addEventListener('input', renderQuestionGrid);
$('t-grid-filter').addEventListener('input', renderTrait);
for (const id of ['c-trait-filter', 'c-only-yes']) $(id).addEventListener('input', renderCharacter);
for (const radio of document.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', () => { state.mode = radio.value; $('notice').hidden = true; });
for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

$('c-quote').addEventListener('input', () => { cDraft(state.view.id).quote = $('c-quote').value; $('c-dirty').hidden = !cDirty(state.view.id); renderCounts(); });
$('c-voice').addEventListener('input', () => { cDraft(state.view.id).voice = $('c-voice').value; $('c-dirty').hidden = !cDirty(state.view.id); renderCounts(); });
$('t-definition').addEventListener('input', () => { tDraft(state.view.id).definition = $('t-definition').value; renderTrait(); renderCounts(); });
$('t-name').addEventListener('input', () => { tDraft('').name = $('t-name').value.trim(); $('t-title').textContent = $('t-name').value.trim() || 'New trait'; });
$('t-file-select').addEventListener('input', () => { tDraft(state.view.id).file = $('t-file-select').value; });
$('t-subjective').addEventListener('change', () => {
  const draft = tDraft(state.view.id);
  draft.no = $('t-subjective').checked ? new Set(draft.no ?? []) : null;
  renderTrait();
  renderCounts();
});

$('new-question').addEventListener('click', () => newQuestion());
$('q-duplicate').addEventListener('click', () => newQuestion(state.view.id));
$('q-rename').addEventListener('click', renameQuestion);
$('q-delete').addEventListener('click', deleteQuestion);
$('q-prev').addEventListener('click', () => step(-1));
$('q-next').addEventListener('click', () => step(1));
$('paste-names').addEventListener('click', pasteNames);
$('undo').addEventListener('click', () => undoRedo('undo', 'redo'));
$('redo').addEventListener('click', () => undoRedo('redo', 'undo'));
$('new-trait').addEventListener('click', newTrait);
$('t-delete').addEventListener('click', deleteTrait);
$('save').addEventListener('click', save);
$('discard').addEventListener('click', discard);
$('show-keys').addEventListener('click', () => $('keys').showModal());
$('validation-close').addEventListener('click', () => { $('validation').hidden = true; });
$('validate').addEventListener('click', async () => {
  showValidation('Running node scripts/validate.js --verbose…');
  const { body } = await api('/api/validate', {});
  showValidation(`${body.code ? 'Problems found' : 'Passed'}\n\n${body.output}`);
});

$('review-load').addEventListener('click', async () => {
  const entries = entriesIn($('review-input').value, $('review-default-reason').value.trim());
  if (!entries.length) { $('review-progress').textContent = 'No known question ids found in that text.'; return; }
  if (await reviewChange('/api/review/add', { entries: entries.map(({ id, reason }) => ({ id, text: reason, source: 'you' })) })) {
    $('review-input').value = '';
    setStatus(`Added ${plural(new Set(entries.map((e) => e.id)).size, 'question')} to the review list.`, 'good');
  }
});
$('review-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $('review-input').value = await file.text();
  $('review-load').click();
  event.target.value = '';
});
for (const id of ['review-source', 'review-hide-done']) $(id).addEventListener('input', renderReviewList);
$('review-clear-done').addEventListener('click', () => removeFromReview(state.review.items.filter((i) => i.reviewed)));
$('review-clear').addEventListener('click', async () => {
  const answer = await ask({ title: 'Clear the whole review list?', text: `This removes all ${state.review.items.length} entries and their notes.`, ok: 'Clear all', danger: true });
  if (answer) await removeFromReview(state.review.items);
});
$('q-review-add').addEventListener('click', () => askForReason(state.view.id));
$('review-add-reason').addEventListener('click', () => askForReason(state.view.id));
$('review-remove').addEventListener('click', () => removeFromReview([reviewItem(state.view.id)].filter(Boolean)));
// Entry changes go one at a time, so each carries the revision the last one returned.
let reviewSaves = Promise.resolve();
function queueReviewUpdate(id, change) {
  reviewSaves = reviewSaves.then(() => {
    const item = reviewItem(id);
    return item ? reviewChange('/api/review/update', { id, rev: item.rev, ...change }) : null;
  });
}
$('reviewed').addEventListener('change', () => queueReviewUpdate(state.view.id, { reviewed: $('reviewed').checked }));
// The decision note saves as you type (debounced).
let resolutionTimer = null;
$('review-resolution').addEventListener('input', () => {
  const id = state.view.id;
  clearTimeout(resolutionTimer);
  resolutionTimer = setTimeout(() => {
    queueReviewUpdate(id, { resolution: $('review-resolution').value });
  }, 500);
});

document.addEventListener('keydown', (event) => {
  const typing = event.target.closest?.('input, textarea, select');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
  if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); step(event.key === 'ArrowDown' ? 1 : -1); return; }
  if (event.key === 'Escape') { $('notice').hidden = true; return; }
  if (typing) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undoRedo(event.shiftKey ? 'redo' : 'undo', event.shiftKey ? 'undo' : 'redo'); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); undoRedo('redo', 'undo'); }
  if (event.key === '/') { event.preventDefault(); showTab('questions'); $('search').focus(); }
});
window.addEventListener('focus', async () => {
  if (!state.data) return;
  await refreshReview();
  renderReviewList();
});
window.addEventListener('beforeunload', (event) => { if (anyDirty()) event.preventDefault(); });

await load();
await loadReview();
renderReviewList();
// Deep links: #q=<question id>, #c=<character id>, #t=<trait>; plain #<question id> too.
const [kind, value] = (() => {
  const hash = decodeURIComponent(location.hash.slice(1));
  const match = hash.match(/^([qct])=(.+)$/);
  return match ? [match[1], match[2]] : ['q', hash];
})();
if (kind === 'q' && state.byId.has(value)) openQuestion(value);
else if (kind === 'c' && state.charById.has(value)) { showTab('characters'); openCharacter(value); }
else if (kind === 't' && state.data.traits[value]) openTrait(value);
else if (state.review.items.some((i) => !i.reviewed)) showTab('review');
