# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Blood on the Clocktower personality quiz. The player answers binary questions; each answer **strictly eliminates** every character on the losing side, and the next question is picked **uniformly at random** from unasked questions that still split the remaining pool. The game ends when one character is left. The goal is a bank of thousands of questions, authored by Claude Code.

## Commands

- `npm run serve` — serve locally at http://localhost:8000 (plain `python -m http.server`; opening `index.html` from disk fails because the data is fetched).
- `npm test` — Node's built-in test runner (`node --test`). Single test: `node --test --test-name-pattern="undo" test/`.
- `npm run validate` — checks the data files. Run after every change to `data/`.

There are no dependencies and no build step.

## Architecture

- `data/characters.json` — character pool (`id`, `name`, `abbr`, `team`, `edition`, `summary`). `summary` is a paraphrase, not official ability text.
- `data/questions.json` — each question is `{ id, text, yes: [characterIds], options? }`. Everyone not in `yes` is on the "no" side. Optional `options: [yesLabel, noLabel]` relabels the buttons for this-or-that questions.
- `js/engine.js` — pure game logic (`Game` class), no DOM. Shared by the browser and the tests; takes an injectable `rng` for deterministic tests.
- `js/app.js` — DOM rendering only. Characters are tokens on a ring (positioned with a CSS `--angle` per token), the question sits in the centre.
- `resources/` — reference material supplied by the user, not loaded by the site: `data/roles.json` (all 181 roles with official ability text, `edition`, `team`), `jinxes.json`, `nightsheet.json`, and token art in `characters/<edition>/<id>[_g|_e].webp`. Character `id`s in `data/` match `roles.json`. Use it as the source of truth when adding characters.
- `scripts/validate.js` — data integrity plus **pairwise separability**: every pair of characters must be split by at least one question. That property guarantees strict elimination never gets stuck, so the engine's `#fallback()` (a direct "does this sound like you?" question) should never fire on shipped data. The tests enforce this.

## Constraints

- Must stay static files only: it's hosted on GitHub Pages and may later move to Mythic Beasts shared hosting (Apache + PHP-FPM + MySQL, no Node). Use relative paths everywhere so it works from a sub-path like `/botc/`.
- CSS: individual `scale` would scale the ring radius, so tokens scale through the `--scale` variable inside `transform`. `[hidden]` is forced to `display: none` because component classes set `display`.
