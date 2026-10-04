# Writing questions

Questions live in `data/questions/*.json`, one file per character group, each listed in `index.json`. Check a file with `node scripts/validate.js <file>.json`, and the whole set (coverage plus simulated games) with `npm run validate`.

## Format

```json
{
  "id": "dem-quiet-killer",
  "plain": "Would you rather kill quietly than make a spectacle of it?",
  "dinniman": "Murder: a craft, or a fireworks show? Some of you file your kills neatly. Some of you want the whole village waking up screaming. Pick a lane, monster.",
  "voice": "The System AI",
  "yes": ["imp", "po"],
  "scope": { "team": "demon" }
}
```

- `yes`: who answers yes. Either a list of character ids, or a match object on fields in `data/characters.json`, e.g. `{ "team": ["minion", "demon"] }` or `{ "otherNight": true }`. All fields must match.
- `scope` (optional): the sub-pool the question is about, using the same selector forms. **Without a scope** the question is *global*: everyone not on the yes side is on the no side, and it can be asked at any point. **With a scope**, it's only asked when every remaining character is inside the scope, and the "no" side is the rest of the scope. Every `yes` character must be inside the scope.
- `voice`: who speaks the `dinniman` line (see below).
- `id`: kebab-case and unique, prefixed by file: `global-`, `tfc-` (core townsfolk), `tfx-` (experimental townsfolk), `out-`, `min-`, `dem-`, `tfl-` (travellers, fabled, loric).

## Accuracy is the whole game

Strict elimination means one wrong tag permanently removes the right answer. Before adding a question:

- **Global questions must be true for every yes character and false for every one of the other 180.** Check across all teams and editions, not just your own group. Ability text is in `resources/data/roles.json` (`ability`, plus `flavor` for personality).
- **Scoped questions must be true for every yes character and false for every other character in the scope.** Characters outside the scope don't matter, and the wording may presuppose the scope ("As a Demon…", "Of the people who learn things at night…").
- Ask about the person taking the quiz: their preferences, temperament and playstyle, in a way that maps cleanly onto the character's ability or flavour. Someone who loves that character should naturally answer the same way. Direct, ability-shaped questions are fine when they're phrased as a wish or temperament ("Would you like to…", "Do you enjoy…").
- Don't name the character in either phrasing. Team names are fine.
- If you're unsure whether a character belongs on the yes side, rephrase until you're sure, or leave the question out.

## Shape of the pool

- **Narrow splits are welcome**: one or two characters against everyone else is a great question. Aim for every character to have at least two narrow global questions that single them out (or them plus one or two others).
- **Same split, fresh question is fine**: several questions may select exactly the same characters as long as each has a different angle and different wording.
- **Scoped questions** separate characters within a group: a whole team (`{ "team": "demon" }`), a team within an edition (`{ "team": "townsfolk", "edition": "tb" }`), a functional group (an id list), or a set of look-alikes. Larger scopes are eligible more often, so favour whole-team and whole-alignment scopes, with some smaller ones for fine distinctions.

## The two phrasings

**`plain`**: clear British English, one yes/no question, ending in "?". Under about 25 words. No jargon beyond common Clocktower terms (Demon, Minion, Storyteller, nominate, execute, Grimoire).

**`dinniman`**: the same question, in a voice from Matt Dinniman's *Dungeon Crawler Carl* books, credited in `voice`. One to three sentences, under about 60 words, and it **must end with a yes/no question that means exactly the same as the plain one**. Spread the questions across the cast:

- **The System AI** (`"voice": "The System AI"`): gleeful, sadistic and increasingly unhinged. Fake achievements, loot boxes, patch notes, and a keen interest in ratings and sponsors.
- **Carl** (`"voice": "Carl"`): dry, exasperated, practical and decent underneath. Deadpan understatement, with a contestant's-eye view of how stupid the game is.
- **Princess Donut** (`"voice": "Princess Donut"`): a vain, imperious show cat, utterly certain of her own star quality. Dramatic, demanding, occasional ALL-CAPS outrage, and fond of her fans.
- **Mordecai** (`"voice": "Mordecai"`): a weary, gruff game guide who has seen too many contestants die. Blunt tactical advice and dark gallows humour.
- **Katia** (`"voice": "Katia"`): earnest, steady and kind, a shapeshifter who has grown into her own strength. Encouraging, quietly brave, and honest about fear.
- **Zev** (`"voice": "Zev"`): the showrunners' PR liaison. Chirpy, corporate and relentlessly on-message about branding, sponsors and audience numbers, whatever the body count.
- **Odette** (`"voice": "Odette"`): a polished talk-show host and former contestant. Probing interview questions, honeyed menace, always angling for the juicy confession.
- **Elle** (`"voice": "Elle"`): a feisty, foul-mouthed (within our limits) older woman turned ice elemental. Cheerfully irreverent and unimpressed by anyone's nonsense.
- **Mongo** (`"voice": "Mongo"`): a loyal, enthusiastic dinosaur. Mostly his name and noises; use sparingly, with a translation or narration attached so the question stays clear.
- **Samantha** (`"voice": "Samantha"`): a bloodthirsty, self-declared goddess who is a talking head. Bombastic, violent and delighted by carnage. Keep her strictly non-sexual.
- **Prepotente** (`"voice": "Prepotente"`): a theatrical, scheming, ego-driven goat. Grand pronouncements and sudden screaming.
- **The show's host or commentators** (`"voice": "The Host"`): slick, cheerful and indifferent to suffering, all audience hype.
- Other characters from the books are welcome when their voice suits the question. Credit them by name.

Use the main cast widely. Carl, Princess Donut, Mordecai and the System AI can carry more of the load, but every file should feature at least eight different voices.

Mild swearing is fine (hell, damn, crap, ass). Nothing stronger, no slurs, no sexual content. Write original lines that capture each character's voice: never copy passages from the books. Vary openings and speakers. No single voice should dominate a file.

## Examples

```json
[
  {
    "id": "global-holding-a-clue",
    "plain": "Would you like to start the game already knowing something useful?",
    "dinniman": "Some contestants grind for every scrap of information. Others get a free clue the moment the doors lock, like a participation trophy for being born lucky. Are you the lucky kind?",
    "voice": "The System AI",
    "yes": { "startsKnowing": true }
  },
  {
    "id": "global-evil-team",
    "plain": "Are you secretly working against the town?",
    "dinniman": "Look, I'm not judging. Okay, I'm judging a little. But if you're planning to smile at these people all day and knife them all night, I'd like to know now. Is that you?",
    "voice": "Carl",
    "yes": { "team": ["minion", "demon"] }
  },
  {
    "id": "tfc-counting-over-naming",
    "plain": "Do numbers tell you more than names do?",
    "dinniman": "Names are for gossips, darling. A TRUE star reads the numbers: ratings, followers, how many evil people are sitting next to her. Do you prefer the cold, hard count?",
    "voice": "Princess Donut",
    "yes": ["chef", "empath", "clockmaker", "mathematician"],
    "scope": ["chef", "empath", "clockmaker", "mathematician", "washerwoman", "librarian", "investigator", "grandmother"]
  }
]
```
