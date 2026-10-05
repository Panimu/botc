// The daily hunt page: choose questions to find the day's hidden character.
// Game rules live in js/daily.js; this file only renders and stores progress.
import { DailyGame, replay, streaks, utcDate, EXCLUDED_FILES, GUESS_THRESHOLD, MAX_WRONG_GUESSES } from './daily.js?v=dev';
import { createCircle } from './circle.js?v=dev';
import { $, side, plural, teamLabel, el, setArt, setupThemeToggle, createPoolList, loadGameData, setupShare } from './shared.js?v=dev';
import { restore, load, save as persist, requestPersistence } from './storage.js?v=dev';

const PROGRESS_KEY = 'daily-progress';
const guessesLeft = (n) => `${n} wrong ${n === 1 ? 'guess' : 'guesses'}`;
const RESULTS_KEY = 'daily-results';

// Durable storage (js/storage.js); the hunt still works if storage is unavailable.
const store = { get: load, set: persist };

// The web host's clock (from the Date response header), so everyone shares the
// same day; falls back to the device clock. Days roll over at midnight UTC.
async function hostClockOffset() {
  try {
    const response = await fetch(`data/questions/index.json?clock=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    const host = Date.parse(response.headers.get('Date'));
    return Number.isFinite(host) ? host - Date.now() : 0;
  } catch {
    return 0;
  }
}

function start(characters, questions, clockOffset) {
  const now = () => new Date(Date.now() + clockOffset);
  const date = utcDate(now());
  const byId = new Map(characters.map((c) => [c.id, c]));
  const saved = store.get(PROGRESS_KEY, null);
  let actions = saved?.date === date ? saved.actions : [];
  let game = new DailyGame({ characters, questions, date });
  try {
    replay(game, actions);
  } catch {
    // Saved progress no longer replays (e.g. the questions changed): start today's hunt afresh.
    game = new DailyGame({ characters, questions, date });
    actions = [];
  }

  const announcer = $('announcer');
  const renderPool = createPoolList($('pool-groups'), $('pool-heading'), characters);
  let selected = null;
  let lastReply = null;

  const circle = createCircle({
    root: $('circle'), ring: $('ring'), count: $('circle-count'), label: $('circle-label'), characters, side,
    onSelect: (id) => select(id),
  });

  function save() {
    store.set(PROGRESS_KEY, { date, actions });
    if (game.status !== 'playing') {
      const results = store.get(RESULTS_KEY, {});
      if (!results[date]) {
        results[date] = { won: game.status === 'won', score: game.score };
        store.set(RESULTS_KEY, results);
        requestPersistence();
      }
    }
  }

  function select(id) {
    if (!game.canGuess || !game.pool.includes(id)) return;
    selected = id;
    render();
    $('guess-confirm').focus();
  }

  function renderOffers() {
    const offers = game.status === 'playing' ? game.offers : [];
    $('hunt-heading').hidden = !offers.length;
    $('offers').replaceChildren(...offers.map((q) => {
      const button = el('button', 'offer');
      button.type = 'button';
      button.append(el('span', 'offer-text', q.plain), el('span', 'offer-id', q.id));
      button.addEventListener('click', () => ask(q.id));
      return button;
    }));
  }

  function renderGuessing() {
    $('guessing').hidden = !game.canGuess;
    $('guess-locked').textContent = game.status === 'playing' && !game.canGuess
      ? `Guessing opens when ${GUESS_THRESHOLD} or fewer remain.` : '';
    if (!game.canGuess) return;
    const left = MAX_WRONG_GUESSES - game.wrongGuesses.length;
    $('guess-hint').textContent = `Guessing is open: tap a token in the circle, or pick a name. A wrong guess costs a point, and you have ${guessesLeft(left)} left.`;
    $('candidates').replaceChildren(...game.pool.map((id) => {
      const button = el('button', `candidate${selected === id ? ' selected' : ''}`);
      button.type = 'button';
      const art = el('img', 'candidate-art');
      art.alt = '';
      setArt(art, byId.get(id));
      button.append(art, el('span', '', byId.get(id).name));
      button.setAttribute('aria-pressed', String(selected === id));
      button.addEventListener('click', () => select(id));
      return button;
    }));
    const confirm = $('guess-confirm');
    confirm.hidden = !selected;
    if (selected) confirm.textContent = `Guess the ${byId.get(selected).name}`;
  }

  // The asked questions and wrong guesses, newest last.
  function historyItems() {
    const items = [];
    game.history.forEach((h, i) => {
      const after = i + 1 < game.history.length ? game.history[i + 1].poolBefore.length : null;
      const li = el('li');
      li.append(`${h.question.plain} `, el('span', 'reply', h.answer ? 'Yes' : 'No'), el('span', 'path-id', ` ${h.question.id}`));
      items.push(li);
    });
    for (const id of game.wrongGuesses) items.push(el('li', 'wrong-guess', `Guessed the ${byId.get(id).name}: wrong`));
    return items;
  }

  // During the hunt: a collapsible list of everything asked so far. At the end: the full list below.
  function renderPath() {
    const playing = game.status === 'playing';
    const count = game.history.length + game.wrongGuesses.length;
    $('history').hidden = !playing || count === 0;
    $('history-summary').textContent = `All questions so far (${count})`;
    $('history-list').replaceChildren(...(playing ? historyItems() : []));
    $('path-list').replaceChildren(...(playing ? [] : historyItems()));
    $('path').hidden = playing || count === 0;
  }

  // Spoiler-free: 👍/👎 per answer, 🪦 per wrong guess (an innocent executed),
  // 🎯 for the right guess, 🔍 when the questions alone found it, 💀 for a loss.
  function shareTexts() {
    const nl = String.fromCharCode(10);
    const url = location.href.split(/[?#]/)[0];
    const solvedByQuestions = game.status === 'won' && Boolean(actions.at(-1)?.ask);
    const answers = game.history.map((h) => (h.answer ? '👍' : '👎')).join('');
    const guesses = '🪦'.repeat(game.wrongGuesses.length);
    const finish = game.status === 'won' ? (solvedByQuestions ? '🔍' : '🎯') : '💀';
    const marks = [answers, guesses, finish].filter(Boolean).join(' ');
    const { current } = streaks(store.get(RESULTS_KEY, {}), date);
    const verdict = game.status === 'won' ? `🎯 Found in ${game.score}` : '💀 The town failed';
    const streak = current > 1 ? ` | 🔥 ${current}-day streak` : '';
    return {
      url,
      plain: shareText(),
      discord: [`🕰️ **Clocktower Daily Hunt #${game.number}**`, `${verdict}${streak}`, marks, `<${url}>`].join(nl),
    };
  }

  function shareText() {
    const marks = game.history.map((h) => (h.answer ? '👍' : '👎')).join('')
      + '🪦'.repeat(game.wrongGuesses.length) + (game.status === 'won' ? '🎯' : '💀');
    const verdict = game.status === 'won' ? `found in ${game.score}` : 'not found';
    const { current } = streaks(store.get(RESULTS_KEY, {}), date);
    return [`Clocktower daily hunt #${game.number}: ${verdict}`, marks, current > 1 ? `Streak: ${current}` : '', location.href.split(/[?#]/)[0]]
      .filter(Boolean).join(String.fromCharCode(10));
  }

  function renderResult() {
    const over = game.status !== 'playing';
    $('result-panel').hidden = !over;
    $('hunt-panel').hidden = over;
    if (!over) return;
    const target = game.targetCharacter;
    setArt($('result-art'), target);
    $('result-art').className = `result-art ${side(target.team)}`;
    $('result-lead').textContent = game.status === 'won' ? `Found in ${plural(game.score, 'point')}. Today's character is the` : "Out of guesses. Today's character was the";
    $('result-name').textContent = target.name;
    $('result-team').className = `result-team ${side(target.team)}`;
    $('result-team').textContent = teamLabel(target.team);
    $('result-summary').textContent = target.summary;
    const s = streaks(store.get(RESULTS_KEY, {}), date);
    const stats = [['Current streak', s.current], ['Best streak', s.best], ['Played', s.played], ['Won', s.wins]];
    $('stats').replaceChildren(...stats.flatMap(([term, value]) => [el('dt', '', term), el('dd', '', String(value))]));
  }

  function renderCountdown() {
    const t = now();
    const midnight = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1);
    const minutes = Math.ceil((midnight - t) / 60000);
    $('countdown').textContent = `Next hunt in ${Math.floor(minutes / 60)}h ${minutes % 60}m.`;
  }

  function render({ focus = null } = {}) {
    if (selected && (!game.canGuess || !game.pool.includes(selected))) selected = null;
    $('hunt-number').textContent = `Hunt #${game.number}`;
    const yesterday = game.yesterday && byId.get(game.yesterday);
    $('yesterday-note').hidden = !yesterday || game.status !== 'playing';
    if (yesterday) $('yesterday-note').textContent = `Yesterday's character, the ${yesterday.name}, can't come up two days running, so they start out of the circle.`;
    $('hunt-score').textContent = `${plural(game.score, 'point')} so far`;
    $('hunt-guesses').textContent = `${game.wrongGuesses.length} of ${MAX_WRONG_GUESSES} wrong guesses`;
    $('last-answer').hidden = !lastReply;
    if (lastReply) {
      $('last-question').textContent = lastReply.question;
      $('last-reply').textContent = lastReply.reply;
    }
    renderOffers();
    renderGuessing();
    renderPath();
    renderResult();
    renderPool(game.pool, game.status === 'playing' ? 'All remaining characters' : 'Characters left at the end');
    circle(game.pool, {
      results: game.status === 'won' ? [game.targetCharacter] : [],
      selectable: game.canGuess,
      selected,
    });
    if (focus) $(focus)?.focus();
  }

  function ask(id) {
    const before = game.pool.length;
    const question = game.offers.find((q) => q.id === id);
    const answer = game.ask(id);
    actions = [...actions, { ask: id }];
    const ruled = before - game.pool.length;
    lastReply = { question: question.plain, reply: `${answer ? 'Yes' : 'No'}. That ruled out ${plural(ruled, 'character')}.` };
    save();
    announcer.textContent = `${lastReply.question} ${lastReply.reply} ${game.pool.length} left.`;
    render({ focus: game.status === 'playing' ? 'hunt-heading' : 'result-name' });
  }

  function guess() {
    if (!selected) return;
    const name = byId.get(selected).name;
    const right = game.guess(selected);
    actions = [...actions, { guess: selected }];
    lastReply = right ? null : { question: `You guessed the ${name}.`, reply: 'Wrong. Their token is shrouded.' };
    selected = null;
    save();
    announcer.textContent = right ? `Yes, it's the ${name}!` : `Not the ${name}. ${guessesLeft(MAX_WRONG_GUESSES - game.wrongGuesses.length)} left.`;
    render({ focus: game.status === 'playing' ? 'guess-hint' : 'result-name' });
  }

  $('guess-confirm').addEventListener('click', guess);
  setupShare($('share-options'), $('share-status'), shareTexts);
  $('guess-hint').tabIndex = -1;
  renderCountdown();
  setInterval(renderCountdown, 30000);
  render();
}

try {
  setupThemeToggle();
  const [{ characters, questions }, , clockOffset] = await Promise.all([
    loadGameData({ exclude: EXCLUDED_FILES }),
    restore([PROGRESS_KEY, RESULTS_KEY]),
    hostClockOffset(),
  ]);
  start(characters, questions, clockOffset);
} catch (error) {
  console.error(error);
  $('hunt-number').textContent = 'The hunt couldn’t start.';
  $('guess-locked').textContent = location.protocol === 'file:'
    ? 'Opening daily.html straight from disk doesn’t work. Serve the folder instead (npm run serve) and visit http://localhost:8000/daily.html.'
    : `Refresh the page to try again. (${error.message})`;
}
