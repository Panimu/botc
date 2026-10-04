// The town circle. While many characters remain, every character is a bead on
// the ring (eliminated ones go dark). Once SEAT_THRESHOLD or fewer remain, the
// survivors slide round the ring into evenly spaced seats and grow into full
// tokens; from then on the eliminated keep their seats, shrouded.
// Every position is a rotation about the centre, so moves travel along the arc.
import { artPath, fallbackArtPath } from './art.js?v=dev';

export const SEAT_THRESHOLD = 15;

const TEAM_ORDER = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'];
const SEAT_STAGGER_MS = 45;

export function createCircle({ root, ring, count, label, characters, side }) {
  const ordered = [...characters].sort((a, b) =>
    TEAM_ORDER.indexOf(a.team) - TEAM_ORDER.indexOf(b.team) || a.name.localeCompare(b.name));

  const tokens = new Map();
  ordered.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = `ring-token ${side(c.team)} team-${c.team}`;
    li.title = c.name;
    li.dataset.name = c.name;
    const img = document.createElement('img');
    img.className = 'ring-art';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => { img.src = fallbackArtPath(c); }, { once: true });
    const name = document.createElement('span');
    name.className = 'ring-name';
    name.textContent = c.name;
    li.append(img, name);
    ring.append(li);
    // Art loads the first time the token takes a seat; beads don't show it.
    tokens.set(c.id, { li, img, src: artPath(c), beadAngle: (360 / ordered.length) * i });
  });

  // Tapping or hovering shows a name in the centre; beads are too small to label.
  let idleLabel = '';
  let labelTimer;
  const showName = (event) => {
    const li = event.target.closest('.ring-token');
    if (!li) return;
    label.textContent = li.dataset.name;
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => { label.textContent = idleLabel; }, 2500);
  };
  root.addEventListener('click', showName);
  root.addEventListener('pointerover', showName);

  let seats = null; // id -> seat angle, fixed from the moment the town sits down

  return function render(pool, { results = [] } = {}) {
    const alive = new Set(pool);
    const seated = pool.length <= SEAT_THRESHOLD;
    let justSeated = false;
    if (!seated) {
      seats = null;
    } else if (!seats || !pool.every((id) => seats.has(id))) {
      const survivors = ordered.filter((c) => alive.has(c.id));
      seats = new Map(survivors.map((c, i) => [c.id, (360 / survivors.length) * i]));
      justSeated = true;
    }
    root.classList.toggle('seated', seated);

    let order = 0;
    for (const [id, { li, img, src, beadAngle }] of tokens) {
      const seat = seats?.get(id);
      const state = !seated ? (alive.has(id) ? 'bead' : 'bead-out')
        : seat === undefined ? 'gone'
        : alive.has(id) ? 'seat' : 'seat-out';
      // Stagger only the moment of sitting down; later changes happen at once.
      li.style.setProperty('--delay', justSeated && state === 'seat' ? `${order++ * SEAT_STAGGER_MS}ms` : '0ms');
      li.style.setProperty('--a', `${seat ?? beadAngle}deg`);
      li.dataset.state = state;
      if (seat !== undefined && !img.getAttribute('src')) img.src = src;
      li.classList.toggle('chosen', results.length === 1 && results[0].id === id);
    }

    count.textContent = results.length ? '' : String(pool.length);
    idleLabel = results.length ? '' : 'left';
    clearTimeout(labelTimer);
    label.textContent = idleLabel;
  };
}
