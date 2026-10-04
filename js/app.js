import { Game } from './engine.js';
import { artPath, fallbackArtPath, EVIL_TEAMS } from './art.js';

const $ = (id) => document.getElementById(id);

const TEAMS = [
  { id: 'townsfolk', heading: 'Townsfolk', label: 'Townsfolk' },
  { id: 'outsider', heading: 'Outsiders', label: 'Outsider' },
  { id: 'minion', heading: 'Minions', label: 'Minion' },
  { id: 'demon', heading: 'Demons', label: 'Demon' },
  { id: 'traveller', heading: 'Travellers', label: 'Traveller' },
  { id: 'fabled', heading: 'Fabled', label: 'Fabled' },
  { id: 'loric', heading: 'Loric', label: 'Loric' },
];
const GOOD_TEAMS = new Set(['townsfolk', 'outsider']);

// Good / evil / other (travellers and storyteller characters), used for border colour.
const side = (team) => (GOOD_TEAMS.has(team) ? 'good' : EVIL_TEAMS.has(team) ? 'evil' : 'other');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setArt(img, character) {
  img.src = artPath(character);
  img.addEventListener('error', () => { img.src = fallbackArtPath(character); }, { once: true });
}

// Builds every team group once; renderPool() only toggles visibility.
function buildPool(characters) {
  const groups = TEAMS.map((team) => {
    const section = el('section', 'team-group');
    const heading = el('h3');
    const list = el('ul', 'tokens');
    const items = characters.filter((c) => c.team === team.id).map((c) => {
      const li = el('li', `token ${side(c.team)}`);
      li.dataset.id = c.id;
      const img = el('img', 'art');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      setArt(img, c);
      li.append(img, el('span', 'name', c.name));
      return li;
    });
    list.append(...items);
    section.append(heading, list);
    return { team, section, heading, items };
  }).filter((g) => g.items.length);
  $('pool-groups').replaceChildren(...groups.map((g) => g.section));
  return groups;
}

function renderPool(groups, pool) {
  const remaining = new Set(pool);
  for (const g of groups) {
    let count = 0;
    for (const li of g.items) {
      const inPool = remaining.has(li.dataset.id);
      li.hidden = !inPool;
      if (inPool) count++;
    }
    g.heading.textContent = `${g.team.heading} (${count})`;
    g.section.hidden = count === 0;
  }
  $('pool-heading').textContent = pool.length === 1 ? 'Your character' : 'Still in the running';
}

function renderPath(game) {
  $('path-list').replaceChildren(...game.history.map((h, i) => {
    const [yesLabel, noLabel] = h.question.options ?? ['Yes', 'No'];
    const after = i + 1 < game.history.length ? game.history[i + 1].pool.length : game.pool.length;
    const li = el('li');
    li.append(`${h.question.text} `, el('span', 'reply', h.answer ? yesLabel : noLabel), el('span', 'left', ` (${h.pool.length} left, then ${after})`));
    return li;
  }));
}

function setupThemeToggle() {
  const button = $('theme-toggle');
  const root = document.documentElement;
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');
  const label = () => { button.textContent = current() === 'dark' ? 'Use light theme' : 'Use dark theme'; };
  button.addEventListener('click', () => {
    root.dataset.theme = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch {}
    label();
  });
  systemDark.addEventListener('change', label);
  label();
  button.hidden = false;
}

function start(characters, questions) {
  const game = new Game({ characters, questions });
  const groups = buildPool(characters);
  const announcer = $('announcer');
  let feedback = '';

  function render({ focus = false } = {}) {
    const result = game.result;
    renderPool(groups, game.pool);
    $('question-panel').hidden = Boolean(result);
    $('result-panel').hidden = !result;
    $('path').hidden = !result;

    if (result) {
      const teamLabel = TEAMS.find((t) => t.id === result.team)?.label ?? result.team;
      const art = $('result-art');
      art.className = `result-art ${side(result.team)}`;
      setArt(art, result);
      $('result-name').textContent = result.name;
      const teamLine = $('result-team');
      teamLine.className = `result-team ${side(result.team)}`;
      teamLine.textContent = teamLabel;
      $('result-summary').textContent = result.summary;
      renderPath(game);
      announcer.textContent = `You are the ${result.name}, ${teamLabel}. ${result.summary}`;
      if (focus) $('result-name').focus();
      return;
    }

    const q = game.current;
    const [yesLabel, noLabel] = q.options ?? ['Yes', 'No'];
    const number = `Question ${game.history.length + 1}`;
    const left = `${game.pool.length} of ${plural(game.characters.length, 'character')} left`;
    $('question-number').textContent = number;
    $('remaining').textContent = left;
    $('question-text').textContent = q.text;
    $('feedback').textContent = feedback;
    $('yes').textContent = yesLabel;
    $('no').textContent = noLabel;
    $('undo').disabled = game.history.length === 0;
    announcer.textContent = [feedback, `${number}, ${left}.`, q.text].filter(Boolean).join(' ');
    if (focus) $('question-text').focus();
  }

  function answer(yes) {
    if (game.done) return;
    const before = game.pool.length;
    game.answer(yes);
    feedback = `That answer ruled out ${plural(before - game.pool.length, 'character')}.`;
    render({ focus: game.done });
  }

  function undo() {
    if (!game.undo()) return;
    feedback = 'Last answer undone.';
    render({ focus: true });
  }

  function restart() {
    game.restart();
    feedback = '';
    render({ focus: true });
  }

  $('yes').addEventListener('click', () => answer(true));
  $('no').addEventListener('click', () => answer(false));
  $('undo').addEventListener('click', undo);
  $('result-undo').addEventListener('click', undo);
  $('restart').addEventListener('click', restart);
  $('play-again').addEventListener('click', restart);

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    if (key === 'y') answer(true);
    else if (key === 'n') answer(false);
    else if (key === 'backspace') { event.preventDefault(); undo(); }
  });

  for (const id of ['answers', 'secondary', 'keys']) $(id).hidden = false;
  render();
}

setupThemeToggle();

try {
  const [characters, questions] = await Promise.all([loadJson('data/characters.json'), loadJson('data/questions.json')]);
  start(characters, questions);
} catch (error) {
  console.error(error);
  $('question-number').textContent = '';
  $('question-text').textContent = 'The question data didn’t load.';
  $('feedback').textContent = 'If you opened index.html straight from disk, serve the folder instead (npm run serve) and visit http://localhost:8000.';
}
