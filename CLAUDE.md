# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Blood on the Clocktower personality quiz covering every character (all 181 roles, including travellers, fabled and loric). The player answers binary questions; each answer **strictly eliminates** every character on the losing side, and the next question is picked **uniformly at random** from unasked questions that still split the remaining pool. The game ends when one character is left. Questions are authored by Claude Code; the user has asked to keep the pool basic for now.

Live at https://panimu.github.io/botc/ (GitHub Pages, deploys from `main` of github.com/Panimu/botc).

## Commands

- `npm run serve` — serve locally at http://localhost:8000 (plain `python -m http.server`; opening `index.html` from disk fails because the data is fetched).
- `npm test` — Node's built-in test runner (`node --test`). Single test: `node --test --test-name-pattern="undo" test/`.
- `npm run validate` — data integrity, art presence, and separability coverage. `--verbose` lists every group of look-alike characters. Run after every change to `data/`.
- `node scripts/build-characters.js` — regenerates `data/characters.json` from `resources/data/`. Don't hand-edit that file.

There are no dependencies and no build step for the site itself.

## Architecture

- `resources/` — reference material supplied by the user and published with the site: `data/roles.json` (all roles with official ability text), `nightsheet.json` (night order), `jinxes.json`, and token art in `characters/<edition>/<id>[_g|_e].webp` (fabled/loric have no suffix; `generic/<team>.webp` is the fallback).
- `data/characters.json` — generated. Per character: `id`, `name`, `team`, `edition`, `summary` (the official ability), `image`, plus boolean fact flags (`firstNight`, `otherNight`, `setup`, and regex-derived ones like `oncePerGame`, `startsKnowing`, `madness`). Add a flag in `ABILITY_FLAGS` in the build script to make it selectable.
- `data/questions.json` — each question is `{ id, text, match | yes, options? }`. `match` selects the "yes" side by character fields (`{ "team": ["minion", "demon"] }`, `{ "otherNight": true }`); `yes` lists ids explicitly. Everyone else is on the "no" side. Optional `options: [yesLabel, noLabel]` relabels the buttons. A question's wording must hold for **every** character it selects.
- `js/engine.js` — pure game logic (`Game`, `resolveYes`), no DOM. Shared by the browser, validator and tests; takes an injectable `rng`.
- `js/app.js` — DOM rendering. Question panel, result panel, and the remaining characters as a grid grouped by team (built once, then toggled with `hidden`).
- `scripts/validate.js` — reports **separability coverage**: pairs of characters no question tells apart. When such characters are all that remain, the engine's `#fallback()` asks "Does this sound like you?" with one character's ability. Raising coverage means adding questions that split the reported look-alike groups.

## Constraints

- Static files only: hosted on GitHub Pages and may later move to Mythic Beasts shared hosting (Apache + PHP-FPM + MySQL, no Node). Use relative paths everywhere so it works from the `/botc/` sub-path.
- Accessibility is a requirement, not a polish pass:
  - Keep every text/background pair at WCAG AA or better in both themes (the current palette is mostly AAA).
  - Never convey team by colour alone: team headings and result labels carry it in text.
  - Keep the page usable at 320 CSS px wide with no horizontal scroll.
  - Announce state changes through `#announcer` (an `aria-live` region), and move focus to the question/result heading after undo, restart and the final answer.
  - Themes follow `prefers-color-scheme`, with a manual override stored in `localStorage` under `theme` and applied by an inline script in `<head>`.
- `[hidden]` is forced to `display: none` because component classes set `display`.
