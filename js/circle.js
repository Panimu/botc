// The town circle. While many characters remain, every character is a bead on
// the ring (eliminated ones go dark). Once SEAT_THRESHOLD or fewer remain, the
// survivors float to random, evenly spaced seats (mixed up, like a real circle)
// and grow into full tokens; from then on the eliminated keep their seats, shrouded.
// Every position is a rotation about the centre, so moves travel along the arc.
import { artPath, fallbackArtPath } from './art.js?v=dev';
import { CIRCLE_TARGET } from './engine.js?v=dev';

// Shared with the engine, which steers questions to seat between min and max.
export const SEAT_THRESHOLD = CIRCLE_TARGET.max;

const TEAM_ORDER = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller'];
// Sitting down is a slow, loosely staggered float; later moves use the CSS default.
const SEAT_FLOAT_MS = 2400;
const SEAT_STAGGER_MS = 700;

// The name follows the bottom edge of the token, as on the physical tokens.
const SVG = 'http://www.w3.org/2000/svg';
function curvedName(character) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ring-name');
  svg.setAttribute('viewBox', '0 0 100 100');
  const path = document.createElementNS(SVG, 'path');
  path.id = `arc-${character.id}`;
  path.setAttribute('d', 'M 13 52 A 37 37 0 0 0 87 52');
  path.setAttribute('fill', 'none');
  const text = document.createElementNS(SVG, 'text');
  const along = document.createElementNS(SVG, 'textPath');
  along.setAttribute('href', `#arc-${character.id}`);
  along.setAttribute('startOffset', '50%');
  along.setAttribute('text-anchor', 'middle');
  along.textContent = character.name;
  text.append(along);
  svg.append(path, text);
  return svg;
}

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The seat angle equivalent (±360°) closest to where the bead is, so each token
// takes the short way round.
function nearest(angle, from) {
  return angle + 360 * Math.round((from - angle) / 360);
}

// onSelect (optional): called with a character id when a seated token is tapped
// while render() was given { selectable: true } (the daily hunt's guessing).
export function createCircle({ root, ring, count, label, characters, side, onSelect }) {
  const ordered = [...characters].sort((a, b) =>
    TEAM_ORDER.indexOf(a.team) - TEAM_ORDER.indexOf(b.team) || a.name.localeCompare(b.name));

  const tokens = new Map();
  ordered.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = `ring-token ${side(c.team)} team-${c.team}`;
    li.title = c.name;
    li.dataset.name = c.name;
    li.dataset.id = c.id;
    const img = document.createElement('img');
    img.className = 'ring-art';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => { img.src = fallbackArtPath(c); }, { once: true });
    li.append(img, curvedName(c));
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
  let selectable = false;
  root.addEventListener('click', (event) => {
    showName(event);
    const li = event.target.closest('.ring-token');
    if (li && selectable && onSelect && li.dataset.state === 'seat') onSelect(li.dataset.id);
  });
  root.addEventListener('pointerover', showName);

  let seats = null; // id -> seat angle, fixed from the moment the town sits down
  let previouslyAlive = new Set(ordered.map((c) => c.id));
  // Beads knocked out by one answer fade in a ripple round the ring, not all at once.
  const RIPPLE_MS = 600;

  // The number in the middle counts down to the new total (rather than jumping),
  // over about as long as the beads take to fade.
  let shown = null;
  let rolling = 0;
  const rollCount = (target, rippleMs) => {
    cancelAnimationFrame(rolling);
    // No roll when unchanged or growing, or while the page is hidden (animation frames pause there).
    if (target === null || shown === null || target >= shown || document.hidden) {
      shown = target;
      count.textContent = target === null ? '' : String(target);
      return;
    }
    const start = shown;
    const began = performance.now();
    const duration = Math.max(500, Math.min(1100, rippleMs + 300));
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      shown = Math.round(start - (start - target) * (1 - (1 - t) ** 3));
      count.textContent = String(shown);
      if (t < 1) rolling = requestAnimationFrame(step);
    };
    rolling = requestAnimationFrame(step);
  };

  return function render(pool, { results = [], selectable: canSelect = false, selected = null, wrong = [] } = {}) {
    selectable = canSelect;
    root.classList.toggle('selectable', selectable);
    const alive = new Set(pool);
    const seated = pool.length <= SEAT_THRESHOLD;
    let justSeated = false;
    if (!seated) {
      seats = null;
    } else if (!seats || !pool.every((id) => seats.has(id))) {
      const survivors = shuffle(ordered.filter((c) => alive.has(c.id)));
      seats = new Map(survivors.map((c, i) => {
        const angle = (360 / survivors.length) * i;
        return [c.id, nearest(angle, tokens.get(c.id).beadAngle)];
      }));
      justSeated = true;
    }
    root.classList.toggle('seated', seated);
    const knockedOut = seated ? [] : ordered.filter((c) => previouslyAlive.has(c.id) && !alive.has(c.id)).map((c) => c.id);
    const rippleStep = knockedOut.length ? Math.min(14, RIPPLE_MS / knockedOut.length) : 0;
    const rippleOrder = new Map(knockedOut.map((id, i) => [id, i]));
    previouslyAlive = alive;

    for (const [id, { li, img, src, beadAngle }] of tokens) {
      const seat = seats?.get(id);
      const state = !seated ? (alive.has(id) ? 'bead' : 'bead-out')
        : seat === undefined ? 'gone'
        : alive.has(id) ? 'seat' : 'seat-out';
      // Only the moment of sitting down floats slowly; later changes use the default.
      const floating = justSeated && state === 'seat';
      const delay = floating ? Math.random() * SEAT_STAGGER_MS : rippleOrder.has(id) ? rippleOrder.get(id) * rippleStep : 0;
      li.style.setProperty('--delay', `${Math.round(delay)}ms`);
      li.style.setProperty('--dur', floating ? `${SEAT_FLOAT_MS}ms` : '');
      li.style.setProperty('--a', `${seat ?? beadAngle}deg`);
      li.dataset.state = state;
      if (seat !== undefined && !img.getAttribute('src')) img.src = src;
      li.classList.toggle('chosen', results.length === 1 && results[0].id === id);
      li.classList.toggle('selected', selected === id);
      li.classList.toggle('wrong', wrong.includes(id));
    }

    rollCount(results.length ? null : pool.length, knockedOut.length * rippleStep);
    idleLabel = results.length ? '' : 'left';
    clearTimeout(labelTimer);
    label.textContent = idleLabel;
  };
}
