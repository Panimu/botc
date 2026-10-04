import { Game } from './engine.js?v=dev';
import { artPath, fallbackArtPath, EVIL_TEAMS } from './art.js?v=dev';

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
      const ability = el('span', 'ability', c.summary);
      ability.hidden = true;
      li.append(img, el('span', 'name', c.name), ability);
      return li;
    });
    list.append(...items);
    section.append(heading, list);
    return { team, section, heading, items };
  }).filter((g) => g.items.length);
  $('pool-groups').replaceChildren(...groups.map((g) => g.section));
  return groups;
}

function renderPool(groups, pool, over) {
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
  $('pool-heading').textContent = !over ? 'Still in the running' : pool.length === 1 ? 'Your character' : 'Your possible characters';
  // Once it's down to a tie, show each ability under the name.
  for (const g of groups) for (const li of g.items) li.querySelector('.ability').hidden = !over || pool.length === 1;
}

function renderPath(game) {
  $('path-list').replaceChildren(...game.history.map((h, i) => {
    const [yesLabel, noLabel] = h.question.options ?? ['Yes', 'No'];
    const after = i + 1 < game.history.length ? game.history[i + 1].pool.length : game.pool.length;
    const li = el('li');
    li.append(`${h.question.plain} `, el('span', 'reply', h.answer ? yesLabel : noLabel), el('span', 'left', ` (${h.pool.length} left, then ${after})`), el('span', 'path-id', ` ${h.question.id}`));
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
  systemDark.addEventListener?.('change', label);
  label();
  button.hidden = false;
}

function start(characters, questions) {
  // Test switch: ?nosingles drops questions with one character on either side of their split.
  const minSide = new URLSearchParams(location.search).has('nosingles') ? 2 : 1;
  const game = new Game({ characters, questions, minSide });
  const groups = buildPool(characters);
  const announcer = $('announcer');
  let feedback = '';

  function renderResult(results) {
    const art = $('result-art');
    const teamLine = $('result-team');
    const name = $('result-name');
    if (results.length === 1) {
      const [result] = results;
      const teamLabel = TEAMS.find((t) => t.id === result.team)?.label ?? result.team;
      art.hidden = false;
      art.className = `result-art ${side(result.team)}`;
      setArt(art, result);
      $('result-lead').textContent = 'You are the';
      name.textContent = result.name;
      name.classList.remove('several');
      teamLine.hidden = false;
      teamLine.className = `result-team ${side(result.team)}`;
      teamLine.textContent = teamLabel;
      $('result-summary').textContent = result.summary;
      announcer.textContent = `You are the ${result.name}, ${teamLabel}. ${result.summary}`;
      return;
    }
    // No question left can split these characters.
    const names = new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(results.map((c) => c.name));
    art.hidden = true;
    teamLine.hidden = true;
    $('result-lead').textContent = `No question can tell these ${results.length} apart yet. You are the`;
    name.textContent = names;
    name.classList.add('several');
    $('result-summary').textContent = 'Their abilities are listed below.';
    announcer.textContent = `No question can tell these apart yet. You are the ${names}.`;
  }

  function render({ focus = false } = {}) {
    const results = game.results;
    const over = results.length > 0;
    renderPool(groups, game.pool, over);
    $('question-panel').hidden = over;
    $('result-panel').hidden = !over;
    $('path').hidden = !over;

    if (over) {
      renderResult(results);
      renderPath(game);
      if (focus) $('result-name').focus();
      return;
    }

    const q = game.current;
    const [yesLabel, noLabel] = q.options ?? ['Yes', 'No'];
    const number = `Question ${game.history.length + 1}`;
    const left = `${game.pool.length} of ${plural(game.characters.length, 'character')} left`;
    $('question-number').textContent = number;
    $('remaining').textContent = left;
    $('question-text').textContent = q.plain;
    $('question-id').textContent = q.id;
    $('flavour-text').textContent = q.dinniman;
    $('flavour-voice').textContent = q.voice;
    $('feedback').textContent = feedback;
    $('yes').textContent = yesLabel;
    $('no').textContent = noLabel;
    $('undo').disabled = game.history.length === 0;
    announcer.textContent = [feedback, `${number}, ${left}.`, q.plain].filter(Boolean).join(' ');
    if (focus) $('question-text').focus();
  }

  // Keep the hover fill off the button just pressed until the pointer moves,
  // so it doesn't look like the new question is already answered.
  const answers = $('answers');
  let answeredAt = 0;
  answers.addEventListener('pointermove', () => {
    if (performance.now() - answeredAt > 250) answers.classList.remove('settling');
  });
  answers.addEventListener('pointerleave', () => answers.classList.remove('settling'));

  function answer(yes) {
    if (game.done) return;
    answers.classList.add('settling');
    answeredAt = performance.now();
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

// The ?v=dev markers are replaced with the commit id on deploy (.github/workflows/pages.yml)
// so browsers never mix cached files from different versions.
try {
  setupThemeToggle();
  const [characters, files] = await Promise.all([loadJson('data/characters.json?v=dev'), loadJson('data/questions/index.json?v=dev')]);
  const questions = (await Promise.all(files.map((file) => loadJson(`data/questions/${file}?v=dev`)))).flat();
  start(characters, questions);
} catch (error) {
  console.error(error);
  $('question-number').textContent = '';
  $('question-text').textContent = 'The quiz couldn’t start.';
  $('feedback').textContent = location.protocol === 'file:'
    ? 'Opening index.html straight from disk doesn’t work. Serve the folder instead (npm run serve) and visit http://localhost:8000.'
    : `Refresh the page to try again. (${error.message})`;
}
