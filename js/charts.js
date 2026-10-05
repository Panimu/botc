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

// How the town shrank: characters left after each step, on a log scale so the
// late, small steps are as readable as the early, big ones. Wrong guesses are
// hollow points (shape, not just colour, marks them). Drawn at the container's
// real width with a fixed height, so text stays its true size and the chart stays
// short; redrawn when the container's width changes.
// steps: [{ label, left, kind: 'start' | 'ask' | 'guess' }]
const drawn = new WeakMap();
export function timelineChart(container, steps) {
  drawTimeline(container, steps);
  if (!drawn.has(container) && 'ResizeObserver' in globalThis) {
    let width = container.clientWidth;
    new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - width) < 8) return;
      width = container.clientWidth;
      drawTimeline(container, drawn.get(container));
    }).observe(container);
  }
  drawn.set(container, steps);
}

function drawTimeline(container, steps) {
  const W = Math.max(240, Math.round(container.clientWidth) || 340), H = 150, L = 34, R = 14, T = 20, B = 24;
  const max = steps[0].left;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, steps.length - 1);
  const y = (v) => T + (1 - Math.log(v) / Math.log(max)) * (H - T - B);
  const svg = node('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img',
    'aria-label': `Characters left after each step: ${steps.map((s) => s.left).join(', ')}.` });

  for (const v of [max, 50, 15, 5, 1].filter((v, i, a) => v <= max && a.indexOf(v) === i)) {
    svg.append(node('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(node('text', { x: L - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, String(v)));
  }
  svg.append(node('text', { x: L, y: H - 6, class: 'tick' }, 'Start'));
  svg.append(node('text', { x: W - R, y: H - 6, class: 'tick', 'text-anchor': 'end' }, `${steps.length - 1} steps`));

  svg.append(node('polyline', { points: steps.map((s, i) => `${x(i)},${y(s.left)}`).join(' '), class: 'line' }));

  // Label the single biggest drop, plus the start and the end.
  let biggest = 1;
  steps.forEach((s, i) => { if (i > 0 && steps[i - 1].left - s.left > steps[biggest - 1].left - steps[biggest].left) biggest = i; });
  steps.forEach((s, i) => {
    const point = node('circle', { cx: x(i), cy: y(s.left), r: 4.5, class: s.kind === 'guess' ? 'point hollow' : 'point' });
    const what = s.kind === 'start' ? 'Start' : s.kind === 'guess' ? `Wrong guess (${s.label})` : `Question ${s.label}`;
    point.append(node('title', {}, `${what}: ${s.left} left`));
    svg.append(point);
  });
  const label = (i, text, dy) => svg.append(node('text', { x: x(i), y: y(steps[i].left) + dy, class: 'value', 'text-anchor': i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'middle' }, text));
  label(0, String(max), -9);
  // Below the line so it never collides with the start label above it.
  if (steps.length > 2 && biggest < steps.length - 1) label(biggest, `−${steps[biggest - 1].left - steps[biggest].left}`, 18);
  label(steps.length - 1, String(steps.at(-1).left), -9);
  container.replaceChildren(svg);
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
