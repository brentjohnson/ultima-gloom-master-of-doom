# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git

Commit to `main` unless asked to branch.

## Commands

```bash
npm run dev          # Play the game. ?seed=4 repeats a run, and ?fight=test opens the combat test arena
npm run build
npm run typecheck    # Checks the engine (no DOM types) and the app as separate projects
npm run lint
npm test             # Vitest: engine, content and balance tests
npm run test:e2e     # Playwright smoke tests; starts its own dev server on port 5199

npx vitest run tests/combat.test.ts      # One test file
npx vitest run -t "regenerates a little" # Tests matching a name
npx playwright test -g "spell cards"     # Browser tests matching a name
```

If Playwright reports a missing browser, run `npx playwright install chromium --only-shell`.

## Documents

- `game-pitch.md`: what the game is and why. It rarely changes.
- `game-design.md`: how the game works, with each rule marked **Built** or **Planned**. Update it when rules or numbers change. It wins over any other source on game rules.
- `implementation-plan.md`: milestone order, current status and technical decisions.

All game names, lore, cards and art must be original. The games named in the pitch inform mechanics only.

## Architecture

Dependencies point one way: `app`, `ui`, `render` and `content` all depend on `engine`, and `engine` depends on nothing else. ESLint enforces this, and also bans `Math.random` and `Date` in the engine.

**Engine (`src/engine`).** All rules run through one pure function:

```
applyAction(state, action) -> { state, events }
```

- `CombatState` is plain JSON and holds its own random number generator, so saving, replaying and tests need no extra support. Never add non-serializable data or randomness from outside the state.
- A fight is self-contained: `createCombat` copies card and basic action definitions into the state, so `applyAction` needs no content lookups.
- `phase` drives the fight: `planning`, then `playerTurn` (which steps through the committed effects), then `ended`. `runTurns` plays enemy turns automatically until the player must choose.
- Self-targeted effects resolve automatically, and effects with no legal choice are skipped. `move` and `attack` actions only cover effects that need a decision.
- Illegal actions throw `IllegalActionError`. Use `legalMoveTargets`, `legalAttackTargets` and `canPlayCard` to find out what's allowed.

**Game layer (`src/engine/game.ts`).** `applyGameAction(state, action, world)` wraps combat with walking, encounters, level changes and the persistent `Character`. `WorldDef` is the fixed world, and `GameState` only records what changed (`tileChanges`, `clearedEncounters`). `mode` is `explore`, `combat` or `dead`. A finished fight stays in `combat` until `finishCombat` applies its result, which leaves room for an end-of-fight screen.

Combat uses level coordinates throughout. Its grid covers only the encounter's area, offset by `originX` and `originY`, and anything outside counts as wall (`tileIndex` and `tileAt` in `grid.ts`). Terrain behavior lives in `TILE_PROPS`.

**Content (`src/content`).** Cards, enemies and basic actions are JSON files validated by strict Zod schemas on load. Prefer adding a card as data. A new effect kind has to be added to `Effect` in `types.ts`, the schema, `settlePlayerEffects` and `describeEffect`.

**Maps.** `maps/world.ldtk` is an LDtk project read by `src/content/ldtk.ts`. It uses a `Terrain` IntGrid layer (unpainted cells are walls) and an `Entities` layer with `PlayerStart`, `Encounter`, `Enemy`, `Exit` and `Transition`. Enemies and exits belong to whichever `Encounter` rectangle contains them. `validateWorld` lists every authoring problem, and a bad map throws at startup. `scripts/generate-world.mjs` wrote the first version and overwrites the file when run, so don't rerun it once the map has been edited in LDtk.

**Presentation.** `GameController` (`src/app/game.ts`) sends each action to the engine, plays the returned events one at a time through `WorldView`, then shows the final `Scene`, which it builds from the state. `busy` is true during playback and blocks input.

- `src/render` draws with PixiJS and contains no rules. Animate from `events` rather than comparing states.
- `src/ui` is Preact and only reads the snapshot and dispatches actions. It offers only legal actions.
- Map clicks go through `GameController.clickTile`, which interprets them according to the current effect.

## Testing

- `tests/helpers.ts` has the shared tools: `setup` builds a fight from ASCII rows (the legend is on `parseArena`), `rigModifier` forces the next modifier draw for exact damage checks, and `botAction` and `playOut` run the greedy bot.
- `tests/balance.test.ts` logs the bot's win rate and fails outside 10-95%. It's a rough check, so re-read the logged numbers after changing rules or content.
- In dev builds the browser tests use `window.__game` to read state and find where to click on the canvas.
