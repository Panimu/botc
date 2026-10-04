// Token art paths, relative to the site root. Shared by js/app.js and scripts/validate.js.
// Good characters use the blue (_g) icon and evil ones the red (_e), matching the physical tokens.

export const EVIL_TEAMS = new Set(['minion', 'demon']);

const suffix = (character) => (EVIL_TEAMS.has(character.team) ? 'e' : 'g');

export function artPath(character) {
  return character.image ?? `resources/characters/${character.edition}/${character.id}_${suffix(character)}.webp`;
}

// Generic team icon, used if a character's own art fails to load.
export function fallbackArtPath(character) {
  return `resources/characters/generic/${character.team}_${suffix(character)}.webp`;
}
