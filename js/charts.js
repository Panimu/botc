// Two small single-series charts for the daily hunt result. One hue (--chart),
// recessive grid and labels in text colours, a native tooltip on every mark,
// and an aria-label summary so the data isn't visual-only.

const SVG = 'http://www.w3.org/2000/svg';
const node = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

// How the town shrank: characters left against points spent, on a log scale so
// the late, small steps are as readable as the early, big ones. Wrong guesses are
// hollow points (shape, not just colour, marks them); the right guess costs no
// point, so it drops straight down. Par's own run is a dashed line from start
// to finish (dash pattern plus a legend, not colour alone, tells it apart).
// Drawn at the container's real width with a fixed height, so text stays its
// true size and the chart stays short; redrawn when the container's width changes.
// steps: [{ label, left, points, kind: 'start' | 'ask' | 'guess' | 'found' }]
// par: { score, path: [{ left, points }] } or null
const drawn = new WeakMap();
export function timelineChart(container, steps, { par = null } = {}) {
  drawn.set(container, { steps, par });
  drawTimeline(container, steps, par);
  if (!container.dataset.observed && 'ResizeObserver' in globalThis) {
    container.dataset.observed = 'true';
    let width = container.clientWidth;
    new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - width) < 8) return;
      width = container.clientWidth;
      const latest = drawn.get(container);
      drawTimeline(container, latest.steps, latest.par);
    }).observe(container);
  }
}

function drawTimeline(container, steps, par) {
  const W = Math.max(240, Math.round(container.clientWidth) || 340), H = 210, L = 38, R = 16, T = 24, B = 30;
  const max = steps[0].left;
  const spent = steps.at(-1).points;
  const parPath = par?.score != null ? par.path : null;
  const domain = Math.max(1, spent, parPath?.at(-1).points ?? 0);
  const x = (points) => L + (points * (W - L - R)) / domain;
  const y = (v) => T + (1 - Math.log(v) / Math.log(max)) * (H - T - B);
  const svg = node('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img',
    'aria-label': `Characters left after each step: ${steps.map((s) => s.left).join(', ')}, using ${spent} ${spent === 1 ? 'point' : 'points'}${parPath ? `. Par: ${parPath.map((s) => s.left).join(', ')}, using ${par.score}` : ''}.` });
  const anchor = (px) => (px <= L + 1 ? 'start' : px >= W - R - 1 ? 'end' : 'middle');

  for (const v of [max, 50, 15, 5, 1].filter((v, i, a) => v <= max && a.indexOf(v) === i)) {
    svg.append(node('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(node('text', { x: L - 7, y: y(v) + 4.5, class: 'tick', 'text-anchor': 'end' }, String(v)));
  }
  svg.append(node('text', { x: L, y: H - 8, class: 'tick' }, 'Start'));
  // Where you finished, and where par finished, on the points axis; one label when
  // they're too close to tell apart.
  const parEnd = parPath ? par.score : null;
  const pointsText = (n) => `${n} ${n === 1 ? 'point' : 'points'}`;
  const close = parEnd != null && Math.abs(x(parEnd) - x(spent)) < 70;
  if (spent > 0) svg.append(node('text', { x: x(spent), y: H - 8, class: 'tick you-end', 'text-anchor': anchor(x(spent)) }, close && parEnd !== spent ? `${pointsText(spent)} (par ${parEnd})` : parEnd === spent ? `${pointsText(spent)}, par` : pointsText(spent)));
  if (parEnd != null && !close) svg.append(node('text', { x: x(parEnd), y: H - 8, class: 'tick par-end', 'text-anchor': anchor(x(parEnd)) }, `par ${parEnd}`));

  if (parPath) {
    const line = node('polyline', { points: parPath.map((s) => `${x(s.points)},${y(s.left)}`).join(' '), class: 'par-line' });
    line.append(node('title', {}, `Par: ${parPath.map((s) => s.left).join(', ')} left, found in ${par.score}`));
    svg.append(line);
    const end = parPath.at(-1);
    svg.append(node('line', { x1: x(end.points), x2: x(end.points), y1: y(end.left) - 6, y2: y(end.left) + 6, class: 'par-end-mark' }));
  }

  svg.append(node('polyline', { points: steps.map((s) => `${x(s.points)},${y(s.left)}`).join(' '), class: 'line' }));

  // Label the single biggest drop, plus the start and the end.
  let biggest = 1;
  steps.forEach((s, i) => { if (i > 0 && steps[i - 1].left - s.left > steps[biggest - 1].left - steps[biggest].left) biggest = i; });
  steps.forEach((s) => {
    const point = node('circle', { cx: x(s.points), cy: y(s.left), r: 5, class: s.kind === 'guess' ? 'point hollow' : 'point' });
    const what = { start: 'Start', guess: `Wrong guess (${s.label})`, found: `Right guess (${s.label})` }[s.kind] ?? `Question ${s.label}`;
    point.append(node('title', {}, `${what}: ${s.left} left`));
    svg.append(point);
  });
  const label = (i, text, dy, dx = 0) => {
    const px = x(steps[i].points);
    svg.append(node('text', { x: px + dx, y: y(steps[i].left) + dy, class: 'value', 'text-anchor': dx ? 'start' : i === 0 ? 'start' : anchor(px) }, text));
  };
  label(0, String(max), -11);
  // Below the line so it never collides with the start label above it.
  if (steps.length > 2 && biggest < steps.length - 1) label(biggest, `−${steps[biggest - 1].left - steps[biggest].left}`, 22);
  // A right guess drops straight down, so its label sits beside the point, clear of the line.
  const last = steps.length - 1;
  if (steps[last].kind === 'found' && last > 0) label(last, String(steps[last].left), 4.5, 9);
  else label(last, String(steps[last].left), -11);
  const legend = document.createElement('p');
  legend.className = 'chart-legend';
  legend.setAttribute('aria-hidden', 'true');
  const key = (cls, text) => {
    const swatch = node('svg', { viewBox: '0 0 24 8', class: 'legend-key' });
    swatch.append(node('line', { x1: 1, x2: 23, y1: 4, y2: 4, class: cls }));
    const item = document.createElement('span');
    item.append(swatch, text);
    return item;
  };
  legend.append(key('you', 'You'));
  if (parPath) legend.append(key('par', `Par (${par.score})`));
  container.replaceChildren(legend, svg);
}

// Your scores: how many hunts you finished with each score, today's highlighted,
// as compact columns (count above, score below) so it stays short as it grows.
// results: { date: { won, score } }
export function scoresChart(container, results, todayScore) {
  const won = Object.values(results).filter((r) => r.won).map((r) => r.score);
  const losses = Object.values(results).filter((r) => !r.won).length;
  if (!won.length && !losses) { container.replaceChildren(); return; }
  const counts = new Map();
  for (const s of won) counts.set(s, (counts.get(s) ?? 0) + 1);
  const rows = [...counts.keys()].sort((a, b) => a - b).map((s) => ({ label: String(s), count: counts.get(s), today: s === todayScore }));
  if (losses) rows.push({ label: 'Lost', count: losses, today: todayScore === null });
  const most = Math.max(...rows.map((r) => r.count));
  const list = document.createElement('ul');
  list.className = 'scores';
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = r.today ? 'today' : '';
    li.title = `${r.label === 'Lost' ? 'Lost' : `Score ${r.label}`}: ${r.count} ${r.count === 1 ? 'hunt' : 'hunts'}${r.today ? ' (today)' : ''}`;
    li.setAttribute('aria-label', li.title);
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = r.label;
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.setProperty('--f', String(r.count / most));
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(r.count);
    li.append(count, bar, score);
    list.append(li);
  }
  container.replaceChildren(list);
}
