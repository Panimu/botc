// The daily hunt page: choose questions to find the day's hidden character.
// Game rules live in js/daily.js; this file renders, stores progress and
// handles the extras (par, charts, archive, streak backup, install, reminder).
import {
  DailyGame, replay, streaks, utcDate, parRun, encodeResults, decodeResults, cleanResults, archiveDate, pastHunts,
  EXCLUDED_FILES, GUESS_THRESHOLD, MAX_WRONG_GUESSES, FREEZE_EVERY, MAX_FREEZES,
} from './daily.js?v=dev';
import { createCircle } from './circle.js?v=dev';
import { timelineChart, scoresChart } from './charts.js?v=dev';
import { $, side, plural, teamLabel, el, setArt, setupThemeToggle, createPoolList, loadGameData, loadJson, setupShare, copyText } from './shared.js?v=dev';
import { restore, load, save as persist, remove, storedKeys, requestPersistence } from './storage.js?v=dev';

// Each day's progress has its own key, so a tab still open on an earlier day's
// hunt can never overwrite today's. LEGACY_PROGRESS_KEY is the old shared key,
// read only to carry over a hunt saved before the change.
const progressKey = (date) => `daily-progress:${date}`;
const LEGACY_PROGRESS_KEY = 'daily-progress';
const PRACTICE_KEY = 'daily-practice-progress';
const RESULTS_KEY = 'daily-results';
const guessesLeft = (n) => `${n} wrong ${n === 1 ? 'guess' : 'guesses'}`;
const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

// Durable storage (js/storage.js); the hunt still works if storage is unavailable.
const store = { get: load, set: persist };

// Registered before the asynchronous startup, so the browser's install offer
// can't arrive unheard; the button is in the page from the start.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('install-app').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-app').hidden = true;
});

const dayBefore = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

// Drops saved progress from before yesterday (yesterday's stays for a tab still open on it).
async function pruneProgress(today) {
  const keep = dayBefore(today);
  for (const key of await storedKeys()) {
    if (key.startsWith('daily-progress:') && key.slice('daily-progress:'.length) < keep) remove(key);
  }
  if ((load(LEGACY_PROGRESS_KEY, null)?.date ?? '') < today) remove(LEGACY_PROGRESS_KEY);
}

// The web host's clock (from the Date response header), so everyone shares the
// same day; null when it can't be read (then the device clock is used). Days
// roll over at midnight UTC.
async function hostClockOffset() {
  try {
    const response = await fetch(`data/questions/index.json?clock=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    const host = Date.parse(response.headers.get('Date'));
    return Number.isFinite(host) ? host - Date.now() : null;
  } catch {
    return null;
  }
}

// Drops malformed entries from the stored results (e.g. from an old, unchecked
// restore link) so they can't break rendering, and saves the cleaned copy.
function repairResults(today) {
  const results = store.get(RESULTS_KEY, null);
  if (results == null) return;
  const clean = cleanResults(results, today);
  if (JSON.stringify(clean) !== JSON.stringify(results)) store.set(RESULTS_KEY, clean);
}

// "two under par", "level with par", "one over par"
function versusPar(score, parScore) {
  if (parScore == null) return '';
  const diff = score - parScore;
  if (diff === 0) return 'level with par';
  const n = Math.abs(diff);
  return `${NUMBER_WORDS[n] ?? n} ${diff < 0 ? 'under' : 'over'} par`;
}

// A restore link in the address bar (#restore=…) merges its results into this device's.
function applyRestoreLink(today) {
  const match = location.hash.match(/^#restore=([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const incoming = decodeResults(match[1], today);
    const results = store.get(RESULTS_KEY, {});
    store.set(RESULTS_KEY, { ...incoming, ...results });
    return `Restored ${plural(Object.keys(incoming).length, 'hunt result')} from your restore link.`;
  } catch {
    return 'That restore link isn’t valid, so nothing was changed.';
  }
}

function start(characters, questions, clockOffset, shareQuotes) {
  const now = () => new Date(Date.now() + clockOffset);
  const today = utcDate(now());
  const practiceDate = archiveDate(new URLSearchParams(location.search).get('date'), today);
  const date = practiceDate ?? today;
  const byId = new Map(characters.map((c) => [c.id, c]));
  const parResult = parRun(date, characters, questions);
  const parScore = parResult.score;

  // Picks up saved progress for this date. startedAt marks the session, so storage
  // can tell a longer copy of this session from an older, different session.
  function resume(key) {
    let saved = store.get(key, null);
    if (!saved && key === progressKey(date)) {
      const legacy = store.get(LEGACY_PROGRESS_KEY, null);
      if (legacy?.date === date) saved = legacy;
    }
    const same = saved?.date === date;
    let actions = same ? saved.actions : [];
    let game = new DailyGame({ characters, questions, date });
    try {
      replay(game, actions);
    } catch {
      // Saved progress no longer replays (e.g. the questions changed): start the hunt afresh.
      game = new DailyGame({ characters, questions, date });
      actions = [];
    }
    return { game, actions, startedAt: same && actions.length && saved.startedAt ? saved.startedAt : Date.now() };
  }

  let saveKey = practiceDate ? PRACTICE_KEY : progressKey(date);
  let { game, actions, startedAt } = resume(saveKey);
  // Today's result is already recorded but the moves behind it aren't here (it came
  // from a restore link, or the saved moves no longer replay). The recorded result
  // stands, and playing again is practice, so the official score never changes.
  const recorded = practiceDate ? null : store.get(RESULTS_KEY, {})[today] ?? null;
  const replayOfToday = Boolean(recorded) && game.status === 'playing';
  if (replayOfToday) {
    saveKey = PRACTICE_KEY;
    ({ game, actions, startedAt } = resume(PRACTICE_KEY));
  }
  const practice = Boolean(practiceDate) || replayOfToday;
  const startCount = game.characters.length - (game.yesterday ? 1 : 0);

  const announcer = $('announcer');
  const renderPool = createPoolList($('pool-groups'), $('pool-heading'), characters);
  let selected = null;
  let lastReply = null;

  const circle = createCircle({
    root: $('circle'), ring: $('ring'), count: $('circle-count'), label: $('circle-label'), characters, side,
    onSelect: (id) => select(id),
  });

  function save() {
    store.set(saveKey, { date, actions, startedAt });
    if (!practice && game.status !== 'playing') {
      const results = store.get(RESULTS_KEY, {});
      if (!results[date]) {
        results[date] = { won: game.status === 'won', score: game.status === 'won' ? game.score : null };
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
    $('offers').replaceChildren(...offers.map((q, i) => {
      const button = el('button', 'offer');
      button.type = 'button';
      button.setAttribute('aria-keyshortcuts', String(i + 1));
      const key = el('kbd', 'offer-key', String(i + 1));
      key.setAttribute('aria-hidden', 'true');
      button.append(el('span', 'offer-text', q.plain), el('span', 'offer-id', q.id), key);
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
    $('guess-hint').textContent = `Guessing is open: tap a token, or pick a name (arrow keys move, Enter picks). A wrong guess costs a point, and you have ${guessesLeft(left)} left.`;
    $('candidates').replaceChildren(...game.pool.map((id) => {
      const button = el('button', `candidate${selected === id ? ' selected' : ''}`);
      button.type = 'button';
      button.dataset.id = id;
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

  // The asked questions and wrong guesses in the order they happened, newest last.
  function historyItems() {
    const asked = new Map(game.history.map((h) => [h.question.id, h]));
    return actions.flatMap((action) => {
      const h = action.ask && asked.get(action.ask);
      if (h) {
        const li = el('li');
        li.append(`${h.question.plain} `, el('span', 'reply', h.answer ? 'Yes' : 'No'), el('span', 'path-id', ` ${h.question.id}`));
        return [li];
      }
      if (action.guess && game.wrongGuesses.includes(action.guess)) return [el('li', 'wrong-guess', `Guessed the ${byId.get(action.guess).name}: wrong`)];
      return [];
    });
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

  // Characters left after each action, and points spent so far, for the timeline chart.
  function timelineSteps() {
    const replayGame = new DailyGame({ characters, questions, date });
    const steps = [{ label: 'start', left: replayGame.pool.length, points: 0, kind: 'start' }];
    let asked = 0;
    for (const action of actions) {
      if (replayGame.status !== 'playing') break;
      if (action.ask) {
        replayGame.ask(action.ask);
        asked++;
        steps.push({ label: String(asked), left: replayGame.pool.length, points: replayGame.score, kind: 'ask' });
      } else if (action.guess) {
        const right = action.guess === replayGame.target;
        replayGame.guess(action.guess);
        steps.push({ label: byId.get(action.guess).name, left: right ? 1 : replayGame.pool.length, points: replayGame.score, kind: right ? 'found' : 'guess' });
      }
    }
    return steps;
  }

  // The page address without unrelated parameters or fragments, keeping a
  // practice hunt's (validated) date so the link opens the same hunt.
  function shareUrl() {
    const url = new URL(location.pathname, location.origin);
    if (practiceDate) url.searchParams.set('date', date);
    return url.href;
  }

  // Spoiler-free: 👍/👎 per answer, 🪦 per wrong guess (an innocent executed),
  // 🎯 for the right guess, 🔍 when the questions alone found it, 💀 for a loss.
  function shareTexts() {
    const nl = String.fromCharCode(10);
    const url = shareUrl();
    const solvedByQuestions = game.status === 'won' && Boolean(actions.at(-1)?.ask);
    const answers = game.history.map((h) => (h.answer ? '👍' : '👎')).join('');
    const guesses = '🪦'.repeat(game.wrongGuesses.length);
    const finish = game.status === 'won' ? (solvedByQuestions ? '🔍' : '🎯') : '💀';
    const marks = [answers, guesses, finish].filter(Boolean).join(' ');
    const { current } = streaks(store.get(RESULTS_KEY, {}), today);
    const parText = game.status === 'won' && parScore != null ? ` (${versusPar(game.score, parScore)})` : '';
    const verdict = game.status === 'won' ? `🎯 Found in ${game.score}${parText}` : '💀 The town failed';
    const streak = !practice && current > 1 ? ` | 🔥 ${current}-day streak` : '';
    const title = `Clocktower Daily Hunt #${game.number}${practice ? ' (practice)' : ''}`;
    return {
      url,
      plain: [`${title}: ${game.status === 'won' ? `found in ${game.score}${parText}` : 'not found'}`, marks, streak ? `Streak: ${current}` : '', url].filter(Boolean).join(nl),
      discord: [`🕰️ **${title}**`, `${verdict}${streak}`, marks, `<${url}>`].filter(Boolean).join(nl),
    };
  }

  function renderResult() {
    const over = game.status !== 'playing';
    $('result-panel').hidden = !over;
    $('hunt-panel').hidden = over;
    if (!over) return;
    const target = game.targetCharacter;
    setArt($('result-art'), target);
    $('result-art').className = `result-art ${side(target.team)}`;
    $('result-lead').textContent = game.status === 'won'
      ? `${replayOfToday ? 'Practice: found' : 'Found'} in ${plural(game.score, 'point')}, ${versusPar(game.score, parScore)}. ${practiceDate ? 'That hunt' : 'Today'}'s character ${practiceDate ? 'was' : 'is'} the`
      : `${replayOfToday ? 'Practice: out' : 'Out'} of guesses. ${practiceDate ? 'That hunt' : 'Today'}'s character was the`;
    $('result-name').textContent = target.name;
    $('result-team').className = `result-team ${side(target.team)}`;
    $('result-team').textContent = teamLabel(target.team);
    $('result-summary').textContent = target.summary;
    const quote = shareQuotes[target.id];
    $('share-quote').hidden = !quote;
    if (quote) $('share-quote-text').textContent = quote.quote;

    const results = store.get(RESULTS_KEY, {});
    const s = streaks(results, today);
    const stats = [['Current streak', s.current], ['Best streak', s.best], ['Played', s.played], ['Streak freezes', s.freezes]];
    $('stats').replaceChildren(...stats.flatMap(([term, value]) => [el('dt', '', term), el('dd', '', String(value))]));
    $('stats').hidden = practice;
    // Scores first: whether they show changes the timeline's width.
    $('scores-figure').hidden = practice || Object.keys(results).length === 0;
    scoresChart($('scores-chart'), results, practice ? undefined : game.status === 'won' ? game.score : null);
    timelineChart($('timeline-chart'), timelineSteps(), { par: parResult });
    $('freeze-text').textContent = `You hold ${plural(s.freezes, 'streak freeze')} (at most ${MAX_FREEZES}). You earn one for every ${FREEZE_EVERY} hunts you win, and a missed day spends one instead of breaking your streak.${s.frozen.length ? ` Frozen so far: ${s.frozen.map(longDate).join(', ')}.` : ''}`;
    $('keep').hidden = practice;
    $('countdown').hidden = Boolean(practiceDate);
  }

  function renderPast() {
    const results = store.get(RESULTS_KEY, {});
    const hunts = pastHunts(today);
    $('past').hidden = hunts.length === 0;
    $('past-list').replaceChildren(...hunts.map(({ number, date: d }) => {
      const li = el('li');
      const link = el('a', '', `Hunt #${number}, ${longDate(d)}`);
      link.href = `?date=${d}`;
      if (d === date) link.setAttribute('aria-current', 'page');
      const r = results[d];
      li.append(link, el('span', 'past-result', r ? (r.won ? `found in ${r.score}` : 'not found') : 'not played'));
      return li;
    }));
  }

  function renderCountdown() {
    const t = now();
    if (!practiceDate && utcDate(t) !== date) {
      // A new UTC day started while the page was open: this page still holds yesterday's hunt.
      $('new-day').hidden = false;
      $('countdown').textContent = "Today's hunt is ready.";
      return;
    }
    const midnight = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1);
    const minutes = Math.ceil((midnight - t) / 60000);
    $('countdown').textContent = `Next hunt in ${Math.floor(minutes / 60)}h ${minutes % 60}m.`;
  }

  function render({ focus = null } = {}) {
    if (selected && (!game.canGuess || !game.pool.includes(selected))) selected = null;
    $('hunt-number').textContent = `Hunt #${game.number}`;
    $('archive-banner').hidden = !practice;
    if (practiceDate) $('archive-text').textContent = `Practice: Hunt #${game.number} from ${longDate(date)}. This won't affect your streak.`;
    if (replayOfToday) $('archive-text').textContent = `You've already finished today's hunt (${recorded.won ? `found in ${plural(recorded.score, 'point')}` : 'not found'}). Playing it again is practice and won't change your result.`;
    $('archive-banner').querySelector('a').hidden = replayOfToday;
    const yesterday = game.yesterday && byId.get(game.yesterday);
    $('yesterday-note').hidden = !yesterday || game.status !== 'playing';
    if (yesterday) $('yesterday-note').textContent = `The previous day's character, the ${yesterday.name}, can't come up two days running, so they start out of the circle.`;
    $('hunt-par').textContent = parScore != null ? `Par ${parScore}` : '';
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
    renderPast();
    renderPool(game.pool, game.status === 'playing' ? 'All remaining characters' : 'Characters left at the end');
    circle(game.pool, {
      results: game.status === 'won' ? [game.targetCharacter] : [],
      selectable: game.canGuess,
      selected,
    });
    if (focus) $(focus)?.focus();
  }

  // A rubber stamp on the answer: YES or NO lands on the card.
  function stamp(answer) {
    const s = $('stamp');
    s.textContent = answer ? 'YES' : 'NO';
    s.className = `stamp ${answer ? 'stamp-yes' : 'stamp-no'}`;
    void s.offsetWidth; // restart the animation
    s.classList.add('stamped');
  }

  function ask(id) {
    const before = game.pool.length;
    const question = game.offers.find((q) => q.id === id);
    if (!question) return;
    const answer = game.ask(id);
    actions = [...actions, { ask: id }];
    lastReply = { question: question.plain, reply: `${answer ? 'Yes' : 'No'}. That ruled out ${plural(before - game.pool.length, 'character')}.` };
    save();
    announcer.textContent = `${lastReply.question} ${lastReply.reply} ${game.pool.length} left.`;
    render({ focus: game.status === 'playing' ? 'hunt-heading' : 'result-name' });
    if (game.status === 'playing') stamp(answer);
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
    if (!right && game.status === 'playing') stamp(false);
  }

  // Keyboard: 1/2/3 ask the offered questions; arrow keys move through the guess candidates.
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
    const index = ['1', '2', '3'].indexOf(event.key);
    if (index >= 0 && game.status === 'playing' && game.offers[index]) { event.preventDefault(); ask(game.offers[index].id); }
  });
  $('candidates').addEventListener('keydown', (event) => {
    const buttons = [...$('candidates').querySelectorAll('button')];
    const at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    buttons[(at + step + buttons.length) % buttons.length].focus();
  });

  // Keep your streak: restore link, calendar reminder, install.
  $('copy-restore').addEventListener('click', async () => {
    const link = `${location.href.split(/[?#]/)[0]}#restore=${encodeResults(store.get(RESULTS_KEY, {}))}`;
    $('keep-status').textContent = (await copyText(link)) ? 'Restore link copied. Keep it somewhere safe.' : `Copy this link by hand: ${link}`;
  });
  $('add-reminder').addEventListener('click', () => {
    const next = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), now().getUTCDate() + 1, 0, 5));
    const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const url = location.href.split(/[?#]/)[0];
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clocktower Daily Hunt//EN', 'BEGIN:VEVENT',
      'UID:clocktower-daily-hunt-reminder@panimu.github.io', `DTSTAMP:${stampOf(new Date())}`, `DTSTART:${stampOf(next)}`,
      'DURATION:PT10M', 'RRULE:FREQ=DAILY', 'SUMMARY:Clocktower Daily Hunt', `DESCRIPTION:A new hunt is ready: ${url}`, `URL:${url}`,
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:A new Clocktower hunt is ready', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })), download: 'clocktower-daily-hunt.ics' });
    link.click();
    URL.revokeObjectURL(link.href);
    $('keep-status').textContent = 'Reminder downloaded. Open it to add a daily event (just after midnight UTC, in your local time) to your calendar.';
  });
  $('install-app').hidden = !installPrompt;
  $('install-app').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('install-app').hidden = true;
  });
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches;
  $('install-hint').hidden = !ios;

  $('guess-confirm').addEventListener('click', guess);
  setupShare($('share-options'), $('share-status'), shareTexts);
  $('guess-hint').tabIndex = -1;
  $('new-day-reload').addEventListener('click', () => location.reload());
  renderCountdown();
  setInterval(renderCountdown, 30000);
  render();
}

try {
  setupThemeToggle();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const [{ characters, questions }, , hostOffset, shareQuotes] = await Promise.all([
    loadGameData({ exclude: EXCLUDED_FILES }),
    restore([LEGACY_PROGRESS_KEY, PRACTICE_KEY, RESULTS_KEY]),
    hostClockOffset(),
    loadJson('data/share-quotes.json?v=dev').catch(() => ({})),
  ]);
  const clockOffset = hostOffset ?? 0;
  // Today's progress key depends on the host's date, so it's restored once that's known.
  const today = utcDate(new Date(Date.now() + clockOffset));
  await restore([progressKey(today)]);
  pruneProgress(today).catch(() => {});
  // Only trust "after today" when the host's clock was read; the device's may run behind.
  repairResults(hostOffset == null ? null : today);
  const restored = applyRestoreLink(today);
  if (restored) { $('restore-status').textContent = restored; $('restore-status').hidden = false; }
  start(characters, questions, clockOffset, shareQuotes);
} catch (error) {
  console.error(error);
  $('hunt-number').textContent = 'The hunt couldn’t start.';
  $('guess-locked').textContent = location.protocol === 'file:'
    ? 'Opening index.html straight from disk doesn’t work. Serve the folder instead (npm run serve) and visit http://localhost:8000.'
    : `Refresh the page to try again. (${error.message})`;
}
