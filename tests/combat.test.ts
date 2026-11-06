import { describe, expect, it } from 'vitest';
import { applyAction, canPlayCard, createCombat, getPlayer, hasLineOfSight, IllegalActionError, legalMoveTargets, parseArena } from '../src/engine';
import { biter, card, cardIdNamed, dummy, playOut, rigModifier, setup, step } from './helpers';
import { testFightSetup } from '../src/content';

const strike = card('strike', 20, 2, [{ kind: 'attack', damage: 3, range: 1 }]);
const step3 = card('step3', 10, 1, [{ kind: 'move', range: 3 }]);
const filler = (n: number) => Array.from({ length: n }, (_, i) => card(`filler${i}`, 60 + i, 1, [{ kind: 'shield', amount: 1 }]));
const fullDeck = (...cards: ReturnType<typeof card>[]) => [...cards, ...filler(10 - cards.length)];

/** Finds a seed where every named card starts in hand, so tests can stay exact. */
function withHand(rows: string[], cards: ReturnType<typeof card>[], enemies = [dummy, biter]) {
  for (let seed = 1; seed < 5000; seed++) {
    const { state } = setup(rows, cards, enemies, seed);
    const names = state.player.hand.map((id) => state.cards[id]?.id);
    if (cards.slice(0, 2).every((c) => names.includes(c.id))) return state;
  }
  throw new Error('no suitable seed');
}

describe('rounds and initiative', () => {
  it('deals a full hand and hides enemy intent until the player commits', () => {
    const { state } = setup(['@.d'], fullDeck(strike));
    expect(state.player.hand).toHaveLength(5);
    expect(state.revealed).toEqual({});
    expect(state.turnOrder).toEqual([]);
  });

  it('runs the lowest initiative first', () => {
    const start = withHand(['@..b'], fullDeck(strike, step3));
    // Biter has initiative 10, so with initiative 20 it reaches the player first.
    const { events, state } = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'strike') });
    const firstTurn = events.find((e) => e.type === 'turnStarted');
    expect(firstTurn).toMatchObject({ figureId: 'e0' });
    expect(state.phase.kind).toBe('playerTurn');
  });

  it('gives the player ties', () => {
    const tied = card('tied', 10, 1, [{ kind: 'shield', amount: 1 }]);
    const start = withHand(['@..b'], fullDeck(tied, step3));
    const { events } = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'tied') });
    expect(events.find((e) => e.type === 'turnStarted')).toMatchObject({ figureId: 'player' });
  });

  it('discards the played card and refills the hand', () => {
    const start = withHand(['@.......d'], fullDeck(step3, strike));
    const id = cardIdNamed(start, 'step3');
    let { state } = step(start, { type: 'playCard', cardId: id });
    ({ state } = step(state, { type: 'move', to: { x: 3, y: 0 } }));
    expect(state.round).toBe(2);
    expect(state.player.discard).toContain(id);
    expect(state.player.hand).toHaveLength(5);
  });
});

describe('stamina', () => {
  it('charges stamina on commit and refuses unaffordable cards', () => {
    const { state } = setup(['@.d'], fullDeck(strike, step3), [dummy, biter], 3, 0);
    const id = state.player.hand[0] as string;
    expect(canPlayCard(state, id)).toBe(false);
    expect(() => applyAction(state, { type: 'playCard', cardId: id })).toThrow(IllegalActionError);
  });

  it('keeps basic actions free, and Catch Breath recovers stamina', () => {
    const { state } = setup(['@......d'], fullDeck(), [dummy, biter], 3, 0);
    const { state: next, events } = step(state, { type: 'useBasic', basic: 'catchBreath' });
    expect(next.player.stamina).toBe(2);
    expect(events).toContainEqual({ type: 'staminaChanged', delta: 2, stamina: 2 });
  });

  it('recovers a quarter of max after a win but nothing after fleeing', () => {
    const kill = card('kill', 5, 2, [{ kind: 'attack', damage: 50, range: 1 }]);
    const start = rigModifier(withHand(['@d'], fullDeck(kill, step3)), 'player', { kind: 'add', value: 0 });
    let { state } = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'kill') });
    ({ state } = step(state, { type: 'attack', targetId: 'e0' }));
    expect(state.phase).toEqual({ kind: 'ended', outcome: 'won' });
    expect(state.player.stamina).toBe(20); // 18 + 5, capped.

    const fleeing = withHand(['E@.....d'], fullDeck(step3, strike));
    let fled = step(fleeing, { type: 'playCard', cardId: cardIdNamed(fleeing, 'step3') }).state;
    fled = step(fled, { type: 'move', to: { x: 0, y: 0 } }).state;
    fled = step(fled, { type: 'flee' }).state;
    expect(fled.phase).toEqual({ kind: 'ended', outcome: 'fled' });
    expect(fled.player.stamina).toBe(19);
  });
});

describe('modifiers', () => {
  const attackWith = (modifier: Parameters<typeof rigModifier>[2], c = strike) => {
    const start = rigModifier(withHand(['@d'], fullDeck(c, step3)), 'player', modifier);
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, c.id) }).state;
    return step(committed, { type: 'attack', targetId: 'e0' });
  };

  it.each([
    [{ kind: 'add', value: 1 } as const, 4],
    [{ kind: 'add', value: -2 } as const, 1],
    [{ kind: 'double' } as const, 6],
    [{ kind: 'null' } as const, 0],
  ])('applies %j', (modifier, total) => {
    const { events } = attackWith(modifier);
    expect(events.find((e) => e.type === 'attacked')).toMatchObject({ base: 3, total });
  });

  it('reshuffles right after x2 or null', () => {
    const { state, events } = attackWith({ kind: 'null' });
    expect(events).toContainEqual({ type: 'modifierDeckShuffled', owner: 'player' });
    expect(state.playerModifiers.discard).toHaveLength(0);
    expect(state.playerModifiers.draw).toHaveLength(21);
  });

  it('never lets damage go below zero', () => {
    const tap = card('tap', 20, 1, [{ kind: 'attack', damage: 1, range: 1 }]);
    const { events } = attackWith({ kind: 'add', value: -2 }, tap);
    expect(events.find((e) => e.type === 'attacked')).toMatchObject({ total: 0 });
  });

  it('skips conditions on a null', () => {
    const c = card('c', 20, 1, [{ kind: 'attack', damage: 2, range: 1, conditions: ['bleed'] }]);
    const { state } = attackWith({ kind: 'null' }, c);
    expect(state.figures[1]?.conditions).toEqual([]);
  });
});

describe('conditions, shields and terrain', () => {
  it('bleed ticks at turn start until healed', () => {
    const start = withHand(['@d'], fullDeck(step3, strike));
    start.figures[0]?.conditions.push('bleed');
    const { state, events } = step(start, { type: 'useBasic', basic: 'catchBreath' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'damaged', figureId: 'player', source: 'bleed', amount: 1 }));
    expect(getPlayer(state).conditions).toContain('bleed');
  });

  it('stun skips the turn', () => {
    const start = withHand(['@.......b'], fullDeck(step3, strike));
    start.figures[1]?.conditions.push('stun');
    const { events, state } = step(start, { type: 'useBasic', basic: 'catchBreath' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'turnSkipped', figureId: 'e0' }));
    expect(state.figures[1]?.pos).toEqual({ x: 8, y: 0 });
    expect(state.figures[1]?.conditions).toEqual([]);
  });

  it('root skips player movement automatically', () => {
    const start = withHand(['@.......d'], fullDeck(step3, strike));
    start.figures[0]?.conditions.push('root');
    const { state, events } = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'step3') });
    expect(events).toContainEqual({ type: 'effectSkipped', kind: 'move' });
    expect(getPlayer(state).pos).toEqual({ x: 0, y: 0 });
    expect(state.round).toBe(2);
  });

  it('shield blocks attack damage for the round but not bleed', () => {
    const guard = card('guard', 1, 1, [{ kind: 'shield', amount: 5 }]);
    const start = rigModifier(withHand(['@b'], fullDeck(guard, step3)), 'enemy', { kind: 'add', value: 0 });
    const { state, events } = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'guard') });
    expect(events.find((e) => e.type === 'damaged')).toMatchObject({ amount: 0, blocked: 2 });
    expect(getPlayer(state).shield).toBe(0); // Cleared for the new round.
  });

  it('push stops at walls and springs traps', () => {
    const shove = card('shove', 1, 1, [{ kind: 'attack', damage: 0, range: 1, push: 3 }]);
    const start = rigModifier(withHand(['@d^.#'], fullDeck(shove, step3)), 'player', { kind: 'add', value: 0 });
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'shove') }).state;
    const { state, events } = step(committed, { type: 'attack', targetId: 'e0' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'trapSprung', figureId: 'e0' }));
    expect(state.figures[1]?.pos).toEqual({ x: 3, y: 0 });
    expect(state.figures[1]?.hp).toBe(8);
    expect(state.tiles[2]).toBe('floor');
  });

  it('walls and water block movement, and walls alone block sight', () => {
    const { state } = setup(['@~.', '###', '.d.'], fullDeck());
    expect(hasLineOfSight(state, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(hasLineOfSight(state, { x: 0, y: 0 }, { x: 0, y: 2 })).toBe(false);
    const start = withHand(['@~.', '...', '.d.'], fullDeck(step3, strike));
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'step3') }).state;
    expect(legalMoveTargets(committed)).not.toContainEqual({ x: 1, y: 0 });
  });

  it('routes around a trap when range allows, and crosses it only when it must', () => {
    const start = withHand(['@^.', '...', 'd..'], fullDeck(step3, strike));
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'step3') }).state;

    const around = step(committed, { type: 'move', to: { x: 1, y: 1 } });
    expect(around.events.some((e) => e.type === 'trapSprung')).toBe(false);
    expect(getPlayer(around.state).hp).toBe(20);

    // Going around to (2,0) takes 4 steps, so range 3 has to cross the trap.
    const across = step(committed, { type: 'move', to: { x: 2, y: 0 } });
    expect(across.events.some((e) => e.type === 'trapSprung')).toBe(true);
    expect(getPlayer(across.state).hp).toBe(18);
  });
});

describe('enemy behavior', () => {
  it('walks into range and attacks', () => {
    const start = rigModifier(withHand(['@...b'], fullDeck(step3, strike)), 'enemy', { kind: 'add', value: 0 });
    const { state } = step(start, { type: 'useBasic', basic: 'catchBreath' });
    expect(state.figures[1]?.pos).toEqual({ x: 1, y: 0 });
    expect(getPlayer(state).hp).toBe(18);
  });

  it('cannot shoot through walls', () => {
    const archer = { id: 'biter', name: 'Archer', hp: 5, behaviors: [{ name: 'Shot', initiative: 10, effects: [{ kind: 'attack' as const, damage: 3, range: 9 }] }] };
    const start = withHand(['@#b'], fullDeck(step3, strike), [archer]);
    const { state } = step(start, { type: 'useBasic', basic: 'catchBreath' });
    expect(getPlayer(state).hp).toBe(20);
  });
});

describe('ending fights', () => {
  it('loses when the player reaches 0 HP', () => {
    const start = withHand(['@b'], fullDeck(step3, strike));
    (start.figures[0] as { hp: number }).hp = 1;
    const rigged = rigModifier(start, 'enemy', { kind: 'add', value: 0 });
    const { state } = step(rigged, { type: 'useBasic', basic: 'catchBreath' });
    expect(state.phase).toEqual({ kind: 'ended', outcome: 'lost' });
    expect(() => applyAction(state, { type: 'skipEffect' })).toThrow(IllegalActionError);
  });

  it('only allows fleeing from an exit', () => {
    const start = withHand(['E.@....d'], fullDeck(step3, strike));
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'step3') }).state;
    expect(() => applyAction(committed, { type: 'flee' })).toThrow(IllegalActionError);
  });

  it('holds the turn open on an exit after all effects are spent, then continues if declined', () => {
    const start = withHand(['E.@....d'], fullDeck(step3, strike));
    let { state } = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'step3') });
    ({ state } = step(state, { type: 'move', to: { x: 0, y: 0 } }));
    expect(state.phase.kind).toBe('playerTurn');
    ({ state } = step(state, { type: 'skipEffect' }));
    expect(state.round).toBe(2);
  });
});

describe('determinism and purity', () => {
  it('replays identically from the same seed and actions', () => {
    const first = createCombat(testFightSetup(42));
    const run = playOut(first.state);
    let replay = createCombat(testFightSetup(42)).state;
    for (const action of run.actions) replay = applyAction(replay, action).state;
    expect(replay).toEqual(run.state);
  });

  it('survives a JSON save and load mid-fight', () => {
    let state = createCombat(testFightSetup(7)).state;
    const run = playOut(state);
    let saved = state;
    run.actions.forEach((action, i) => {
      state = applyAction(state, action).state;
      saved = applyAction(saved, action).state;
      if (i % 3 === 0) saved = JSON.parse(JSON.stringify(saved));
    });
    expect(saved).toEqual(state);
  });

  it('does not mutate the previous state', () => {
    const { state } = createCombat(testFightSetup(5));
    const snapshot = JSON.stringify(state);
    applyAction(state, { type: 'useBasic', basic: 'catchBreath' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('keeps invariants across many fights', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { state } = createCombat(testFightSetup(seed));
      const end = playOut(state).state;
      const cards = [...end.player.hand, ...end.player.deck, ...end.player.discard];
      expect(new Set(cards).size).toBe(Object.keys(end.cards).length);
      expect(end.player.stamina).toBeGreaterThanOrEqual(0);
      const living = end.figures.filter((f) => f.hp > 0);
      expect(new Set(living.map((f) => `${f.pos.x},${f.pos.y}`)).size).toBe(living.length);
    }
  });
});

describe('arena parsing', () => {
  it('rejects unknown tiles and uneven rows', () => {
    expect(() => parseArena(['@?'], {})).toThrow(/Unknown/);
    expect(() => parseArena(['@.', '.'], {})).toThrow(/width/);
    expect(() => parseArena(['..'], {})).toThrow(/player start/);
  });
});
