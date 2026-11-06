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

  it('keeps basic actions free, and Catch Breath restores both pools', () => {
    const { state } = setup(['@......d'], fullDeck(), [dummy, biter], 3, 0, 0);
    const { state: next, events } = step(state, { type: 'useBasic', basic: 'catchBreath' });
    expect(events).toContainEqual({ type: 'resourceChanged', resource: 'stamina', delta: 2, value: 2, source: 'restore' });
    expect(events).toContainEqual({ type: 'resourceChanged', resource: 'mana', delta: 2, value: 2, source: 'restore' });
    // Plus 1 of each from regen as the next round starts.
    expect(next.player.stamina).toBe(3);
    expect(next.player.mana).toBe(3);
  });

  it('regenerates a little each round, up to the maximum', () => {
    const { state } = setup(['@......d'], fullDeck(), [dummy, biter], 3, 19, 10);
    const move = step(state, { type: 'useBasic', basic: 'move' }).state;
    const { state: next } = step(move, { type: 'move', to: { x: 1, y: 0 } });
    expect(next.round).toBe(2);
    expect(next.player.stamina).toBe(20);
    expect(next.player.mana).toBe(10);
    const again = step(step(next, { type: 'useBasic', basic: 'move' }).state, { type: 'move', to: { x: 2, y: 0 } }).state;
    expect(again.player.stamina).toBe(20);
  });

  it('does not regenerate before the first round', () => {
    const { state } = setup(['@......d'], fullDeck(), [dummy, biter], 3, 5, 5);
    expect(state.player.stamina).toBe(5);
    expect(state.player.mana).toBe(5);
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
    expect(events).toContainEqual({ type: 'effectSkipped', kind: 'move', chosen: false });
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

describe('spells', () => {
  const spell = (id: string, initiative: number, cost: number, effects: Parameters<typeof card>[3]) =>
    card(id, initiative, cost, effects, 'mana');

  it('charges mana, not stamina, and refuses a spell without enough mana', () => {
    const bolt = spell('bolt', 20, 3, [{ kind: 'attack', damage: 2, range: 3 }]);
    const start = withHand(['@.d'], fullDeck(bolt, step3));
    const { state } = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'bolt') });
    expect(state.player.mana).toBe(7);
    expect(state.player.stamina).toBe(20);

    const broke = JSON.parse(JSON.stringify(start)) as typeof start;
    broke.player.mana = 2;
    expect(canPlayCard(broke, cardIdNamed(broke, 'bolt'))).toBe(false);
    expect(() => applyAction(broke, { type: 'playCard', cardId: cardIdNamed(broke, 'bolt') })).toThrow(IllegalActionError);
    expect(canPlayCard(broke, cardIdNamed(broke, 'step3'))).toBe(true);
  });

  it('blast hits enemies around the target, but not behind a wall', () => {
    const bloom = spell('bloom', 1, 1, [{ kind: 'attack', damage: 1, range: 9, blast: 2 }]);
    const start = withHand(['@....dd#d', '.....d...'], fullDeck(bloom, step3));
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'bloom') }).state;
    const { events } = step(committed, { type: 'attack', targetId: 'e1' });
    const hit = events.flatMap((e) => (e.type === 'attacked' ? [e.targetId] : []));
    expect(hit.sort()).toEqual(['e0', 'e1', 'e3']);
  });

  it('blink crosses water and figures, works while rooted, and needs sight', () => {
    const hop = spell('hop', 1, 1, [{ kind: 'blink', range: 3 }]);
    const start = withHand(['@~d.', '#...', '....'], fullDeck(hop, step3));
    start.figures[0]?.conditions.push('root');
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'hop') }).state;
    const targets = legalMoveTargets(committed);
    expect(targets).toContainEqual({ x: 3, y: 0 });
    expect(targets).not.toContainEqual({ x: 1, y: 0 }); // Water.
    expect(targets).not.toContainEqual({ x: 2, y: 0 }); // Occupied.
    expect(targets).not.toContainEqual({ x: 0, y: 2 }); // Behind the wall.
    const { state, events } = step(committed, { type: 'move', to: { x: 3, y: 0 } });
    expect(getPlayer(state).pos).toEqual({ x: 3, y: 0 });
    expect(events).toContainEqual({ type: 'blinked', figureId: 'player', path: [{ x: 3, y: 0 }] });
  });

  it('blinking onto a trap still springs it', () => {
    const hop = spell('hop', 1, 1, [{ kind: 'blink', range: 3 }]);
    const start = withHand(['@.^...d'], fullDeck(hop, step3));
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'hop') }).state;
    const { state } = step(committed, { type: 'move', to: { x: 2, y: 0 } });
    expect(getPlayer(state).hp).toBe(18);
  });

  it('Spark reaches past melee, and the basic actions come from data', () => {
    const start = rigModifier(withHand(['@..d'], fullDeck(step3, strike)), 'player', { kind: 'add', value: 0 });
    const committed = step(start, { type: 'useBasic', basic: 'spark' }).state;
    const { events } = step(committed, { type: 'attack', targetId: 'e0' });
    expect(events.find((e) => e.type === 'attacked')).toMatchObject({ base: 1, total: 1 });
  });
});

describe('declining a card effect', () => {
  it('lets the player skip a move and still hit everything adjacent', () => {
    const cleave = card('cleave', 1, 2, [{ kind: 'move', range: 1 }, { kind: 'attack', damage: 3, range: 1, allAdjacent: true }]);
    const start = withHand(['.d.', 'd@.', '...'], fullDeck(cleave, step3));
    const committed = step(start, { type: 'playCard', cardId: cardIdNamed(start, 'cleave') }).state;
    const skipped = step(committed, { type: 'skipEffect' });
    expect(skipped.events).toContainEqual({ type: 'effectSkipped', kind: 'move', chosen: true });
    expect(getPlayer(skipped.state).pos).toEqual({ x: 1, y: 1 });
    const { events } = step(skipped.state, { type: 'attack', targetId: 'e0' });
    const hit = events.flatMap((e) => (e.type === 'attacked' ? [e.targetId] : []));
    expect(hit.sort()).toEqual(['e0', 'e1']);
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
