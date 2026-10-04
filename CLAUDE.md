# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Blood on the Clocktower personality quiz covering every character (all 181 roles, including travellers, fabled and loric). The player answers binary questions; each answer **strictly eliminates** every character on the losing side, and the next question is picked **uniformly at random** from unasked questions that still split the remaining pool. The game ends when one character is left. Questions are authored by Claude Code, following `data/questions/GUIDE.md` (format, accuracy rules, and the Dungeon Crawler Carl voice cast). Each question has a plain phrasing and a `dinniman` phrasing credited to a `voice`; both are shown for now.

Live at https://panimu.github.io/botc/. Every push to `main` of github.com/Panimu/botc runs `.github/workflows/pages.yml`, which validates, tests, stamps asset URLs and deploys to GitHub Pages.

**Cache-busting:** Pages caches files for 10 minutes, and a browser that mixes a new `index.html` with an old cached script breaks. So every reference to our own JS, CSS and JSON carries `?v=dev` (in `index.html`, `import` lines and `fetch` calls), and the workflow replaces it with the commit id. Add the marker to any new asset reference, including new module imports. A Mythic Beasts upload would need the same `sed` step.

## Commands

- `npm run serve` — serve locally at http://localhost:8000 (plain `python -m http.server`; opening `index.html` from disk fails because the data is fetched).
- `npm test` — Node's built-in test runner (`node --test`). Single test: `node --test --test-name-pattern="undo" test/`.
- `npm run validate`: data integrity, art presence, separability coverage, and simulated games. `--verbose` lists every unseparated pair. Run after every change to `data/`.
- `node scripts/build-characters.js` — regenerates `data/characters.json` from `resources/data/`. Don't hand-edit that file.

There are no dependencies and no build step for the site itself.

## Architecture

- `resources/` — reference material supplied by the user and published with the site: `data/roles.json` (all roles with official ability text), `nightsheet.json` (night order), `jinxes.json`, and token art in `characters/<edition>/<id>[_g|_e].webp` (fabled/loric have no suffix; `generic/<team>.webp` is the fallback).
- `data/characters.json` — generated. Per character: `id`, `name`, `team`, `edition`, `summary` (the official ability), `image`, plus boolean fact flags (`firstNight`, `otherNight`, `setup`, and regex-derived ones like `oncePerGame`, `startsKnowing`, `madness`). Add a flag in `ABILITY_FLAGS` in the build script to make it selectable.
- `data/questions/*.json`: one file per character group, all listed in `data/questions/index.json`, which the app and validator load. Each question is `{ id, plain, dinniman, voice, yes, scope? }`. `yes` and `scope` are selectors: an id list, or a match object on character fields (`{ "team": ["minion", "demon"] }`, `{ "otherNight": true }`). **Without `scope`** the question is global and everyone else is on the "no" side. **With `scope`** it's only asked when the whole remaining pool is inside the scope, so its wording can presuppose that context. Note that `firstNight`/`otherNight` mean "on the Storyteller's night sheet", not "wakes".
- `js/engine.js` — pure game logic (`Game`, `select`, `prepare`, `splits`), no DOM. Shared by the browser, validator and tests; takes an injectable `rng`.
- `js/app.js` — DOM rendering. Question panel, result panel, and the remaining characters as a grid grouped by team (built once, then toggled with `hidden`).
- `scripts/validate.js` checks integrity: both phrasings and a voice, selectors that resolve, yes ⊂ scope, no duplicate ids or text. `node scripts/validate.js <file>.json` checks one file. Run without arguments, it also reports separability coverage and **simulates games**: average length, and how often a game ends **unresolved**. There's no fallback question: when no question splits the remaining characters, the game ends listing all of them. With scoped questions, pairwise separability doesn't guarantee every game resolves, so the simulation is the real measure.

## Constraints

- Static files only: hosted on GitHub Pages and may later move to Mythic Beasts shared hosting (Apache + PHP-FPM + MySQL, no Node). Use relative paths everywhere so it works from the `/botc/` sub-path.
- Accessibility is a requirement, not a polish pass:
  - Keep every text/background pair at WCAG AA or better in both themes (the current palette is mostly AAA).
  - Never convey team by colour alone: team headings and result labels carry it in text.
  - Keep the page usable at 320 CSS px wide with no horizontal scroll.
  - Announce state changes through `#announcer` (an `aria-live` region), and move focus to the question/result heading after undo, restart and the final answer.
  - Themes follow `prefers-color-scheme`, with a manual override stored in `localStorage` under `theme` and applied by an inline script in `<head>`.
- `[hidden]` is forced to `display: none` because component classes set `display`.
