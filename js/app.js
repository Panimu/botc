import { Game } from './engine.js';
import { artPath, fallbackArtPath, EVIL_TEAMS as EVIL } from './art.js';

const $ = (id) => document.getElementById(id);
const ring = $('ring');
const centre = $('centre');
const controls = $('controls');
const yesButton = $('yes');
const noButton = $('no');
const undoButton = $('undo');
const pathSection = $('path');
const pathList = $('path-list');

const TEAM_LABEL = { townsfolk: 'Townsfolk', outsider: 'Outsider', minion: 'Minion', demon: 'Demon', traveller: 'Traveller', fabled: 'Fabled' };

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

function tokenArt(character, className = 'art') {
  const img = el('img', className);
  img.src = artPath(character);
  img.alt = '';
  img.decoding = 'async';
  img.addEventListener('error', () => { img.src = fallbackArtPath(character); }, { once: true });
  return img;
}

function buildRing(characters) {
  ring.replaceChildren(...characters.map((c, i) => {
    const li = el('li', `token${EVIL.has(c.team) ? ' evil' : ''}`);
    li.dataset.id = c.id;
    li.style.setProperty('--angle', `${(360 / characters.length) * i}deg`);
    li.title = c.name;
    li.append(tokenArt(c), el('span', 'name', c.name));
    return li;
  }));
}

function render(game) {
  const pool = new Set(game.pool);
  const result = game.result;
  for (const li of ring.children) {
    li.classList.toggle('out', !pool.has(li.dataset.id));
    li.classList.toggle('chosen', result?.id === li.dataset.id);
    li.setAttribute('aria-hidden', pool.has(li.dataset.id) ? 'false' : 'true');
  }

  undoButton.disabled = game.history.length === 0;

  if (result) {
    const good = !EVIL.has(result.team);
    centre.replaceChildren(
      tokenArt(result, 'result-art'),
      el('p', 'status', 'You are the'),
      el('p', 'result-name', result.name),
      el('p', `result-team ${good ? 'good' : 'evil'}`, TEAM_LABEL[result.team] ?? result.team),
      el('p', 'result-summary', result.summary),
    );
    yesButton.parentElement.hidden = true;
    renderPath(game);
    return;
  }

  const q = game.current;
  const [yesLabel, noLabel] = q.options ?? ['Yes', 'No'];
  yesButton.textContent = yesLabel;
  noButton.textContent = noLabel;
  yesButton.parentElement.hidden = false;
  pathSection.hidden = true;

  centre.replaceChildren(
    el('p', 'status', `Question ${game.history.length + 1}`),
    el('p', `question${q.fallback ? ' fallback' : ''}`, q.text),
    el('p', 'status', `${game.pool.length} of ${game.characters.length} remain`),
  );
}

function renderPath(game) {
  pathList.replaceChildren(...game.history.map((h, i) => {
    const [yesLabel, noLabel] = h.question.options ?? ['Yes', 'No'];
    const remaining = i + 1 < game.history.length ? game.history[i + 1].pool.length : game.pool.length;
    const li = el('li');
    li.append(
      `${h.question.text} `,
      el('span', 'reply', h.answer ? yesLabel : noLabel),
      el('span', 'left', ` (${h.pool.length} → ${remaining})`),
    );
    return li;
  }));
  pathSection.hidden = false;
}

try {
  const [characters, questions] = await Promise.all([
    loadJson('data/characters.json'),
    loadJson('data/questions.json'),
  ]);
  const game = new Game({ characters, questions });
  buildRing(characters);

  const answer = (yes) => { if (!game.done) { game.answer(yes); render(game); } };
  yesButton.addEventListener('click', () => answer(true));
  noButton.addEventListener('click', () => answer(false));
  undoButton.addEventListener('click', () => { if (game.undo()) render(game); });
  $('restart').addEventListener('click', () => { game.restart(); render(game); });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'y' || event.key === 'Y') answer(true);
    else if (event.key === 'n' || event.key === 'N') answer(false);
    else if (event.key === 'Backspace' && game.undo()) render(game);
  });

  controls.hidden = false;
  render(game);
} catch (error) {
  console.error(error);
  centre.replaceChildren(el('p', 'status',
    'The question data didn’t load. If you opened index.html straight from disk, serve the folder instead (npm run serve) and visit http://localhost:8000.'));
}
