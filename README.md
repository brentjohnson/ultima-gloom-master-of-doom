# Cardbearer

*Working title.* A retro-styled, single-player overhead RPG. You explore a fixed, hand-made world, fight with tactical card combat, and grow by collecting cards with randomized properties and leveling up without a class. Danger is placed by design and never scales to you.

## Status

Early prototype. There is one playable test fight, with no world, loot or saves yet. Combat is being playtested before the world gets built, and the sprites are placeholders.

The test fight has:

- Initiative-based turns, where you commit one card or basic action each round
- Stamina and mana, with spell cards and free basic actions
- An attack modifier deck, conditions, shields, pushes, traps and terrain

## Run it

Developed on Node 24.

```bash
npm install
npm run dev
```

Then open the URL it prints. Add `?seed=4` to the URL to replay the same fight setup.

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
