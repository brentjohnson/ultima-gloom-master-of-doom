# Cardbearer: Vertical Slice Implementation Plan

## Context

`game-pitch.md` says what the game is, and `game-design.md` says how it works, including which rules are built or planned. This plan covers only the order of work. **If the two disagree on a rule, `game-design.md` wins.**

**Goal:** a complete, replayable slice with one town, one stretch of wilderness and one dungeon, proving the full loop of explore, fight, loot, grow and push further. Combat gets a playtest gate before any world is built, since the game depends on it. Later regions are planned only after the slice has been played.

**Current status:** Milestones 0-2.5 are built, and combat is at the playtest gate.

## Technical decisions

| Topic | Decision |
|---|---|
| Stack | TypeScript (strict), Vite, PixiJS for maps, Preact and CSS for cards and menus, Vitest, Playwright, LDtk, Zod. Runs locally in a browser with no server |
| Scope | Solo only, with no networking |
| Battlefield | Fights happen in place on the world map, with one tile as one combat square on a square grid |
| Art | Original placeholder sprites for now. A 16x16 CC0 pack replaces them once the user has downloaded one, credited in `assets/CREDITS.md` |

All game names, lore, cards and art must be original. The touchstones inform mechanics only.

## Architecture

The engine is pure and deterministic, and everything else depends on it, never the reverse:

```
applyAction(state, action) -> { state, events }
```

- State is plain JSON and includes the seeded random number generator, so saves and replays come free.
- The UI animates from `events` rather than inferring what changed.
- `src/engine` has no DOM types (its own `tsconfig` omits `lib.dom`). Lint rules ban `Math.random` and `Date` there, as well as imports from other layers.
- Card behavior is built from a small set of reusable effects. New cards should only need data unless they require a new effect.
- **New for leveling and mana:** a persistent character record (level, XP, pool maximums and current values, basic action levels, collection, deck) lives outside combat. `createCombat` takes it as input, and the character is updated from the fight's result. Basic actions become data derived from their levels, replacing the fixed `struggle*` rules values.

```
src/engine/    combat rules, modifiers, enemy AI, pathfinding and sight, loot rolls, world rules, character progression
src/content/   Zod schemas plus cards, affixes, enemies, loot tables and level tables as data
src/render/    PixiJS map, sprites, camera and event animation
src/ui/        Preact: hand, initiative track, deck builder, level-up, shop, dialogue
src/app/       game loop, input, save storage, screens
maps/          LDtk project and its JSON export
assets/        tiles and CREDITS.md
tests/         engine tests, content checks, balance bot, browser smoke test
```

Excluded from the slice:
- Non-card gear
- Mobile support
- Audio beyond a few effects
- Additional regions

## Milestones

Each milestone ends with something playable or testable.

0. **Setup.** Done.
1. **Rules engine, no graphics.** Done.
2. **Playable fight.** Done, and in playtesting.

2.5. **Mana and basic actions in combat.** Done, so the playtest covers the real resource model.
   - Add a mana pool and mana costs on cards, with cards costing either stamina or mana.
   - Regenerate stamina and mana slowly each combat round.
   - Catch Breath restores both pools.
   - Add the Spark basic action, and rename Struggle: Move and Struggle: Attack to Move and Attack.
   - Add 3-4 test spell cards, with the new effects they need (such as area attacks and blink movement).
   - Show a mana bar and each card's cost type in the UI. Explain the orthogonal adjacency rule there too.
   - **Playtest gate (covers Milestones 2 and 2.5):** play several fights and tune the rules. If it isn't fun, change the rules before building more. Settle the combat questions in `game-design.md`: diagonal adjacency, hidden enemy plans, modifier swing and post-fight recovery.

3. **World.** Add an LDtk import with a validation step, tile-by-tile movement, a camera, terrain properties, doors, traps, a darker dungeon view, and the seamless switch into combat in place. Add stamina and mana regen per step, and carry the character between fights.
4. **Loot and decks.** Add rarities, affix rolling, zone loot tables, drops, a collection screen and the deck builder.
5. **Leveling.** Add danger-weighted XP from enemies, rising level thresholds and a level-up screen where you grow one pool and upgrade one basic action. Decide what each upgrade improves, and whether a level cap is needed. Add the "two levels above your lowest" rule only if playtesting calls for it.
6. **Persistence and stakes.** Add rest points that refill all pools, zone resets with claimed uniques kept, versioned `localStorage` saves with file export and import, the death penalty and Hardcore mode.
7. **Slice content.**
   - One town with an inn, a card shop and NPCs who give rumors
   - Wilderness with a clear "safe ring" and a visibly dangerous area
   - A 3-floor dungeon with a boss
   - About 25 cards including spells, 6-8 enemy types and 10-15 affixes
   - Then a balance pass, including fighter, caster and balanced builds

## Verification

- **Static and unit checks:** `npm run typecheck`, `npm run lint` and `npm test` all pass.
- **Determinism:** replaying the same seed and actions produces identical state, and saving and reloading mid-fight doesn't change the outcome.
- **Content:** every card, affix, enemy, loot table, level table and LDtk entity passes validation at test time, including references between them. Each encounter must also have a reachable exit.
- **Resources:** pools never exceed their maximums or fall below zero, regen is applied once per round and per step, and a card can't be played without enough of the right pool.
- **Progression:** level-ups apply exactly one pool increase and one basic action upgrade, upgrades change basic actions but never cards, and XP from one enemy doesn't depend on player level.
- **Balance bot:** a simple scripted player runs many seeded fights headlessly, reporting win rates and resources left per encounter. Early zones should be clearly easier than deep ones at the same level, confirming difficulty by place. The bot is a rough check and doesn't replace playtesting.
- **Browser smoke test:** Playwright starts a new game, walks into a fight, plays a card, saves and reloads.
- **Full playthrough by hand:**
  1. Start a new character and die in the dangerous area.
  2. Grow through loot, the shop and level-ups, trying both a fighter and a caster lean.
  3. Rest and confirm pools refill, enemies return, and claimed uniques do not.
  4. Beat the boss.
  5. Die on a Hardcore character and confirm the save is gone.
