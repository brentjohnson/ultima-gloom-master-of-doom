# Cardbearer

*Working title.* A retro-styled, single-player overhead RPG. You explore a fixed, hand-made world, fight with tactical card combat, and grow by collecting cards with randomized properties and leveling up without a class. Danger is placed by design and never scales to you.

## Status

Early prototype, with no saves yet, and the sprites and small test map are placeholders. So far you can:

- Walk a small overworld and a dark dungeon, with doors, traps and stairs
- Fight in place when you enter enemy ground, and flee from marked exits
- Commit one card or basic action each round, in initiative order
- Spend stamina and mana on physical and spell cards, with an attack modifier deck, conditions, shields and pushes
- Win cards with randomly rolled properties, then choose your deck from your collection
- Level up from XP, growing health, stamina or mana and upgrading a basic action

## Run it

Developed on Node 24.

```bash
npm install
npm run dev
```

Then open the URL it prints. Add `?seed=4` to the URL to repeat a run, or `?fight=test` to go straight to the combat test arena.

## Development

```bash
npm test             # Engine, content and balance tests
npm run test:e2e     # Browser smoke tests
npm run typecheck
npm run lint
npm run build
```

Browser tests need a Playwright browser, which you can install with `npx playwright install chromium --only-shell`.

Built with TypeScript, Vite, PixiJS and Preact. The rules live in a pure, deterministic engine in `src/engine`, separate from rendering and UI.

## Documents

- [game-pitch.md](game-pitch.md): what the game is and why
- [game-design.md](game-design.md): how it works, with each rule marked built or planned
- [implementation-plan.md](implementation-plan.md): milestones and technical decisions
