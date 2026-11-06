import { describe, expect, it } from 'vitest';
import { ENEMIES, ENEMY_KEYS, CARDS, STARTER_DECK, TEST_ARENA, testFightSetup } from '../src/content';
import { loadCards } from '../src/content/schemas';
import { createCombat, findPath, parseArena } from '../src/engine';

describe('content', () => {
  it('loads a legal starter deck', () => {
    expect(CARDS.size).toBeGreaterThanOrEqual(8);
    expect(STARTER_DECK.length).toBeGreaterThanOrEqual(10);
    expect(STARTER_DECK.length).toBeLessThanOrEqual(20);
  });

  it('resolves every arena enemy key to a definition', () => {
    for (const id of Object.values(ENEMY_KEYS)) expect(ENEMIES.has(id)).toBe(true);
  });

  it('rejects malformed and duplicate cards', () => {
    const good = { id: 'a', name: 'A', initiative: 10, staminaCost: 1, effects: [{ kind: 'move', range: 1 }] };
    expect(() => loadCards([good, good])).toThrow(/Duplicate/);
    expect(() => loadCards([{ ...good, initiative: 0 }])).toThrow();
    expect(() => loadCards([{ ...good, effects: [{ kind: 'teleport' }] }])).toThrow();
    expect(() => loadCards([{ ...good, typo: 1 }])).toThrow();
  });

  it('gives the test arena a reachable exit', () => {
    const layout = parseArena(TEST_ARENA, ENEMY_KEYS);
    const { state } = createCombat(testFightSetup(1));
    expect(layout.exits.length).toBeGreaterThan(0);
    const reachable = layout.exits.some((exit) => findPath(state, layout.playerStart, exit, 999) !== null);
    expect(reachable).toBe(true);
  });
});
