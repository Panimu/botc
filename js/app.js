import { Game } from './engine.js?v=dev';
import { createCircle } from './circle.js?v=dev';
import { $, side, plural, teamLabel, el, setArt, setupThemeToggle, createPoolList, loadGameData, loadJson, setupShare, TEAM_EMOJI } from './shared.js?v=dev';

function renderPath(game) {
  $('path-list').replaceChildren(...game.history.map((h, i) => {
    const [yesLabel, noLabel] = h.question.options ?? ['Yes', 'No'];
    const after = i + 1 < game.history.length ? game.history[i + 1].pool.length : game.pool.length;
    const li = el('li');
    li.append(`${h.question.styled} `, el('span', 'reply', h.answer ? yesLabel : noLabel), el('span', 'left', ` (${h.pool.length} left, then ${after})`), el('span', 'path-id', ` ${h.question.id}`));
    return li;
  }));
}

function start(characters, questions, shareQuotes) {
  // Test switch: ?nosingles drops questions with one character on either side of their split.
  const minSide = new URLSearchParams(location.search).has('nosingles') ? 2 : 1;
  const game = new Game({ characters, questions, minSide });
  const renderPool = createPoolList($('pool-groups'), $('pool-heading'), characters);
  const circle = createCircle({
    root: $('circle'), ring: $('ring'), count: $('circle-count'), label: $('circle-label'), characters, side,
  });
  const announcer = $('announcer');
  let feedback = '';

  function renderResult(results) {
    const art = $('result-art');
    const teamLine = $('result-team');
    const name = $('result-name');
    if (results.length === 1) {
      const [result] = results;
      const team = teamLabel(result.team);
      art.hidden = false;
      art.className = `result-art ${side(result.team)}`;
      setArt(art, result);
      $('result-lead').textContent = 'You are the';
      name.textContent = result.name;
      name.classList.remove('several');
      teamLine.hidden = false;
      teamLine.className = `result-team ${side(result.team)}`;
      teamLine.textContent = team;
      $('result-summary').textContent = result.summary;
      renderVerdict(result);
      renderShare(result);
      announcer.textContent = `You are the ${result.name}, ${team}. ${result.summary}`;
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
    $('why').hidden = true;
    $('nearly').hidden = true;
    nearly = null;
    renderShare(null);
    announcer.textContent = `No question can tell these apart yet. You are the ${names}.`;
  }

  // "What gave you away": the answers that set you apart from the most of the
  // town at the time (the smallest share of the pool answering the same way).
  // "You were nearly…": a character ruled out by the final answer, preferring
  // one on the same team.
  let nearly = null;
  function renderVerdict(result) {
    const defining = game.history
      .map((h) => {
        const same = h.pool.filter((id) => h.question.yesSet.has(id) === h.answer).length;
        return { h, share: same / h.pool.length };
      })
      .sort((a, b) => a.share - b.share)
      .slice(0, 3);
    $('why-list').replaceChildren(...defining.map(({ h }) => {
      const li = el('li');
      li.append(`${h.question.plain} `, el('span', 'reply', h.answer ? 'Yes' : 'No'));
      return li;
    }));
    $('why').hidden = defining.length === 0;

    const last = game.history.at(-1);
    const ruledOut = last ? last.pool.filter((id) => !game.pool.includes(id)).map((id) => game.characters.find((c) => c.id === id)) : [];
    nearly = ruledOut.find((c) => c.team === result.team) ?? ruledOut.sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
    $('nearly').hidden = !nearly;
    if (nearly) {
      setArt($('nearly-art'), nearly);
      $('nearly-text').textContent = `You were nearly the ${nearly.name}.`;
    }
  }

  // The finale: the winning token lifts out of the circle and becomes the result card's art,
  // then the rest of the card rises in beneath it.
  function reveal(id) {
    const token = document.querySelector(`.ring-token[data-id="${id}"]`);
    const art = $('result-art');
    if (!token || !art.animate) return;
    const from = token.getBoundingClientRect();
    const to = art.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    art.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: 'none' }],
      { duration: 1100, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    [...$('result-panel').children].filter((child) => child !== art && !child.hidden).forEach((child, i) => {
      child.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
        { duration: 500, delay: 650 + i * 70, easing: 'ease-out', fill: 'backwards' });
    });
  }

  // Share: copy buttons, Discord first, with the character's quote.
  let texts = { discord: '', plain: '', url: '' };
  function renderShare(result) {
    $('share-options').hidden = !result;
    $('share-quote').hidden = true;
    $('share-status').textContent = '';
    if (!result) return;
    const quote = shareQuotes[result.id];
    if (quote) {
      $('share-quote-text').textContent = quote.quote;
      $('share-quote').hidden = false;
    }
    const url = location.href.split(/[?#]/)[0];
    const team = teamLabel(result.team);
    const nl = String.fromCharCode(10);
    texts = {
      url,
      plain: [`I'm the ${result.name} (${team}) in Which Clocktower character are you?`, quote ? `"${quote.quote}"` : '', nearly ? `(Nearly the ${nearly.name}.)` : '', url].filter(Boolean).join(nl),
      discord: [
        `🕰️ **I'm the ${result.name}!** ${TEAM_EMOJI[result.team] ?? ''} ${team}`,
        quote ? `> ${quote.quote}` : '',
        nearly ? `*Nearly the ${nearly.name}.*` : '',
        `🔮 Which Clocktower character are you? ${url}`,
      ].filter(Boolean).join(nl),
    };
  }
  setupShare($('share-options'), $('share-status'), () => texts);

  function render({ focus = false } = {}) {
    const results = game.results;
    const over = results.length > 0;
    renderPool(game.pool, !over ? 'All remaining characters' : game.pool.length === 1 ? 'Your character' : 'Your possible characters', { showAbilities: over && game.pool.length > 1 });
    circle(game.pool, { results });
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
    const left = `${game.pool.length} of ${game.characters.length} left`;
    $('question-number').textContent = number;
    $('remaining').textContent = left;
    $('question-text').textContent = q.styled;
    $('question-id').textContent = q.id;
    $('feedback').textContent = feedback;
    $('yes').querySelector('.answer-label').textContent = yesLabel;
    $('no').querySelector('.answer-label').textContent = noLabel;
    $('undo').disabled = game.history.length === 0;
    announcer.textContent = [feedback, `${number}, ${left}.`, q.styled].filter(Boolean).join(' ');
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
    if (game.done && game.results.length === 1) reveal(game.results[0].id);
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
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target.closest('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    if (key === 'y') answer(true);
    else if (key === 'n') answer(false);
    else if (key === 'backspace') { event.preventDefault(); undo(); }
  });

  for (const id of ['answers', 'secondary']) $(id).hidden = false;
  render();
}

// The ?v=dev markers are replaced with the commit id on deploy (.github/workflows/pages.yml)
// so browsers never mix cached files from different versions.
try {
  setupThemeToggle();
  const [{ characters, questions }, shareQuotes] = await Promise.all([
    loadGameData(),
    loadJson('data/share-quotes.json?v=dev').catch(() => ({})),
  ]);
  start(characters, questions, shareQuotes);
} catch (error) {
  console.error(error);
  $('question-number').textContent = '';
  $('question-text').textContent = 'The quiz couldn’t start.';
  $('feedback').textContent = location.protocol === 'file:'
    ? 'Opening quiz.html straight from disk doesn’t work. Serve the folder instead (npm run serve) and visit http://localhost:8000/quiz.html.'
    : `Refresh the page to try again. (${error.message})`;
}
