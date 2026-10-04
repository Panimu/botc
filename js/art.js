// Token art paths, relative to the site root. Shared by js/app.js and scripts/validate.js.
// scripts/build-characters.js fills in `image`; good characters use the blue (_g)
// icon and evil ones the red (_e), matching the physical tokens.

export const EVIL_TEAMS = new Set(['minion', 'demon']);

export function artPath(character) {
  return character.image ?? `resources/characters/${character.edition}/${character.id}_${EVIL_TEAMS.has(character.team) ? 'e' : 'g'}.webp`;
}

// Generic team icon, used if a character's own art fails to load.
export function fallbackArtPath(character) {
  return `resources/characters/generic/${character.team}.webp`;
}
