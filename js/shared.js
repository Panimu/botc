// Helpers shared by the personality quiz (js/app.js) and the daily hunt (js/daily-app.js).
import { artPath, fallbackArtPath, EVIL_TEAMS } from './art.js?v=dev';

export const $ = (id) => document.getElementById(id);

export const TEAMS = [
  { id: 'townsfolk', heading: 'Townsfolk', label: 'Townsfolk' },
  { id: 'outsider', heading: 'Outsiders', label: 'Outsider' },
  { id: 'minion', heading: 'Minions', label: 'Minion' },
  { id: 'demon', heading: 'Demons', label: 'Demon' },
  { id: 'traveller', heading: 'Travellers', label: 'Traveller' },
];
const GOOD_TEAMS = new Set(['townsfolk', 'outsider']);

// Good / evil / other (Travellers), used for colours.
export const side = (team) => (GOOD_TEAMS.has(team) ? 'good' : EVIL_TEAMS.has(team) ? 'evil' : 'other');
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const teamLabel = (team) => TEAMS.find((t) => t.id === team)?.label ?? team;

export async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

// Characters plus every question file listed in data/questions/index.json, except `exclude`.
export async function loadGameData({ exclude = [] } = {}) {
  const [characters, files] = await Promise.all([loadJson('data/characters.json?v=dev'), loadJson('data/questions/index.json?v=dev')]);
  const wanted = files.filter((file) => !exclude.includes(file));
  const questions = (await Promise.all(wanted.map((file) => loadJson(`data/questions/${file}?v=dev`)))).flat();
  return { characters, questions };
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setArt(img, character) {
  img.src = artPath(character);
  img.addEventListener('error', () => { img.src = fallbackArtPath(character); }, { once: true });
}

export function setupThemeToggle() {
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

// Builds the collapsible list of remaining characters, grouped by team; returns
// render(pool, heading) which only toggles visibility.
export function createPoolList(container, headingEl, characters) {
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
  container.replaceChildren(...groups.map((g) => g.section));

  return function render(pool, heading, { showAbilities = false } = {}) {
    const remaining = new Set(pool);
    for (const g of groups) {
      let count = 0;
      for (const li of g.items) {
        const inPool = remaining.has(li.dataset.id);
        li.hidden = !inPool;
        li.querySelector('.ability').hidden = !showAbilities;
        if (inPool) count++;
      }
      g.heading.textContent = `${g.team.heading} (${count})`;
      g.section.hidden = count === 0;
    }
    headingEl.textContent = `${heading} (${pool.length})`;
  };
}

// Copy to the clipboard, with a fallback for browsers without the async API.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text });
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

// Share buttons: Discord-formatted, plain text, link, and the system share
// sheet where one exists (mostly phones). getTexts() returns { discord, plain, url }.
export function setupShare(container, status, getTexts) {
  const options = [
    ['Copy for Discord', (t) => t.discord, 'Copied for Discord: paste it into any channel.'],
    ['Copy text', (t) => t.plain, 'Copied to your clipboard.'],
    ['Copy link', (t) => t.url, 'Link copied.'],
  ];
  const buttons = options.map(([label, pick, done], i) => {
    const button = el('button', i === 0 ? 'answer share-main' : 'quiet', label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      const text = pick(getTexts());
      status.textContent = (await copyText(text)) ? done : `Couldn’t copy automatically. Here it is to copy by hand: ${text}`;
    });
    return button;
  });
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    const native = el('button', 'quiet', 'Share…');
    native.type = 'button';
    native.addEventListener('click', async () => {
      try { await navigator.share({ text: getTexts().plain }); } catch {}
    });
    buttons.push(native);
  }
  container.replaceChildren(...buttons);
}
