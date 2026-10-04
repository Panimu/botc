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
- `id`: kebab-case and unique, prefixed by file: `global-`, `tfc-` (core townsfolk), `tfx-` (experimental townsfolk), `out-`, `min-`, `dem-`, `tfl-` (travellers, in `travellers.json`), `xd-`, `xi-`, `xm-`, `xs-`, `xp-` for the cross-type files, and `fun-` for `fun.json` (comedy-first questions).

## Accuracy is the whole game

Strict elimination means one wrong tag permanently removes the right answer. Before adding a question:

- **Global questions must be true for every yes character and false for every other character (156 in all; Fabled and Loric aren't in the quiz).** Check across all teams and editions, not just your own group. Ability text is in `resources/data/roles.json` (`ability`, plus `flavor` for personality).
- **Scoped questions must be true for every yes character and false for every other character in the scope.** Characters outside the scope don't matter, and the wording may presuppose the scope ("As a Demon…", "Of the people who learn things at night…").
- Ask about the person taking the quiz: their preferences, temperament and playstyle, in a way that maps cleanly onto the character's ability or flavour. Someone who loves that character should naturally answer the same way. Direct, ability-shaped questions are fine when they're phrased as a wish or temperament ("Would you like to…", "Do you enjoy…").
- Don't name the character in either phrasing. Team names are fine.
- If you're unsure whether a character belongs on the yes side, rephrase until you're sure, or leave the question out.

### Known traps (found in review)

- **Permissive phrasing:** "Would you be fine with…", "Would you accept…" and "Could you…" get a yes from anyone who doesn't mind. Ask what they'd *like*, or what their ability *does*. Opinion questions ("Is that the best start?") can draw a no from the character's own fans.
- **Preference contests between look-alikes:** "Would you rather X than Y" questions can swap answers between similar characters (the High Priestess, General and Fisherman, for instance). Scope them, or tie them to the specific mechanic.

- **Crude flags:** `learns`, `choosesPlayers`, `aboutDeath`, `aboutVoting`, `madness`, `drunkOrPoisoned`, `aboutAlignment`, `startsKnowing` and `oncePerGame` are keyword matches on ability text, not rules facts, so don't use them as selectors in new questions. For example, `choosesPlayers` really means "makes any choice", and `startsKnowing` misses the Evil Twin, Widow, Summoner and Boffin. Use hand-tagged traits, `team`, `edition`, `setup` or id lists instead.
- **Night 1:** in games of 7+ players every Minion and Demon wakes on night 1 to meet their team, and the Demon gets bluffs. Questions about starting with knowledge or acting on night 1 must say "because of your own ability".
- **The night sheet:** `firstNight`/`otherNight` mean the Storyteller has something to do, not that the player wakes.
- **Demons that don't kill at night:** the Riot (kills through nominations on day 3) and the Leviathan (doesn't kill).
- **Good characters that kill at night:** the Lycanthrope, for one.
- **The Vizier is publicly known**, so "secretly evil" is false for it.
- **Having an alignment means you aren't a Traveller.** Travellers have no fixed side (the Storyteller assigns one), so they answer **no** to every "are you good / evil / on the town's side" question, and a yes rules them out. Keep them on the no side of alignment questions rather than scoping them out, unless the question is deliberately scoped to good-only or evil-only characters. Questions *about* a Traveller's assigned side or other players' alignment (e.g. "a player who shares your alignment") are fine.
- **Borrowed and believed abilities:** the Cannibal, Alchemist, Apprentice and Pixie borrow abilities. The Drunk and Marionette act as the character they believe they are. The Hermit holds every Outsider ability. Keep these on a fixed side with explicit wording or id lists.
- **"Once per game, whenever you choose"** excludes the Juggler (day 1 only) and death triggers like the Klutz and Moonchild. It includes the Puzzlemaster.
- **The Hermit:** with the Drunk ability, it believes it's a Townsfolk, so include it in "believes they're another character" questions. It only has the abilities of Outsiders on the script, and single-character globals need "your whole role" wording to exclude it.
- **The Atheist:** executing the Atheist does nothing; good wins by executing the *Storyteller*.
- **The Puzzlemaster:** its guess can be private, so it isn't a public action.
- **The Judge:** a failed vote only saves that nominee, and the day carries on. The Vizier can force an execution only if a good player voted, and can never force a fail.
- **The Barista:** the Storyteller chooses who is affected and how, so the Barista player chooses nothing.
- **"Your execution loses the game"** catches every Demon unless it's limited to good players.
- **Travellers' characters are public**: everyone knows which Traveller you are, though not your alignment. "Everyone knows your character" questions must exclude them.
- **The Pit-Hag** changes characters but never alignment, so it isn't a "turn someone evil" character.
- **The Moonchild's curse** only kills good players, which is a trap for "only kills the innocent" wording. **The Cult Leader** never chooses a player at night (the Storyteller sets its alignment from its neighbours), but it does have a public daytime action.
- **The Mayor** might "bounce" a night kill to someone else, so "attacks bounce off you" and "someone dies in your place" catch it. Use "never" or "no way" for true immunity. **The Tea Lady's** protection covers execution, so watch "executed but survives" wording.
- **The Evil Twin** starts knowing a good player and their character. **The Wraith** watches who wakes, so night-tracking questions need "the Storyteller tells you".
- **The madness rule** means trying to convince the group you're a character, with a penalty if you don't. Handing out bluffs (Snitch, Summoner) isn't madness, and neither is the Lunatic believing it's the Demon.

## Shape of the pool

- **Narrow splits are welcome**: one or two characters against everyone else is a great question. Aim for every character to have at least two narrow global questions that single them out (or them plus one or two others).
- **Same split, fresh question is fine**: several questions may select exactly the same characters as long as each has a different angle and different wording.
- **Scoped questions** separate characters within a group: a whole team (`{ "team": "demon" }`), a team within an edition (`{ "team": "townsfolk", "edition": "tb" }`), a functional group (an id list), or a set of look-alikes. Larger scopes are eligible more often, so favour whole-team and whole-alignment scopes, with some smaller ones for fine distinctions.

## Cross-type questions and traits

Lots of the bank should mix character types, with Townsfolk, Outsiders, Minions, Demons and Travellers spread across the sides. "Do you kill?" catches Demons, but also the Assassin, Gossip, Slayer and Gunslinger, and leaves other Demons-adjacent and good characters on the no side. These questions cut the pool by large mixed chunks, which keeps games short and makes scoped questions reachable.

Cross-type questions live in `cross-*.json`. Mixing is the aim, not a rule: a question with one type on a side is fine when it's the right question. `npm run validate` reports how much of the bank mixes types.

They select characters through **traits**: shared, precisely defined tags in `data/traits/*.json`:

```json
{
  "killsAtNight": {
    "definition": "The character's own ability can directly cause a player's death at night (not via execution, not only by making others drunk).",
    "yes": ["imp", "po", "gossip", "assassin", "godfather"]
  }
}
```

After editing a trait file, run `node scripts/build-characters.js`. That adds each trait as a boolean field on every character, so questions can use `{ "killsAtNight": true }` and combine it with other fields, e.g. `{ "killsAtNight": true, "team": ["townsfolk", "outsider"] }` for good characters who kill.

- A trait is a fact about the ability as the wiki describes it, never a vibe. Write the definition first, then tag every one of the 156 characters against it. Going through `data/characters.json` one by one is the only way to be sure.
- A trait can feed many questions. Fixing one tag corrects all of them.
- Scopes can be traits too: `"scope": { "killsAtNight": true }` makes a question about killers that's only asked once the pool is all killers.

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
    "plain": "Does your own ability hand you a clue at the very start, rather than fresh information each night?",
    "dinniman": "Some contestants grind for every scrap of information. Others get a free clue the moment the doors lock, like a participation trophy for being born lucky. Does your ability make you the lucky kind?",
    "voice": "The System AI",
    "yes": ["steward", "knight", "chef", "noble", "investigator", "washerwoman", "clockmaker", "grandmother", "librarian", "shugenja", "pixie", "bountyhunter"]
  },
  {
    "id": "global-evil-team",
    "plain": "Are you on the evil team, working against the town?",
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
