import { describe, expect, it } from 'vitest';
import { AFFIXES, BASICS, CARDS, ENEMIES, LOOT, STARTER_DECK, TEST_WORLD, WORLD } from '../src/content';
import { loadLoot } from '../src/content/schemas';
import { applyAction, applyGameAction, eligibleAffixes, IllegalActionError, newGame, parseArena, resolveCard, rollDrop } from '../src/engine';
import type { AffixDef, CardDef, CombatState, DropRarity, GameState, LevelDef, LootTable, OwnedCard, WorldDef } from '../src/engine';
import { setup } from './helpers';

const table = (name: string): LootTable => LOOT.tables[name] as LootTable;
const owned = (defId: string, rarity: OwnedCard['rarity'], affixes: string[]): OwnedCard => ({ uid: 'x', defId, rarity, affixes });
const resolve = (defId: string, ...affixes: string[]): CardDef => resolveCard(owned(defId, 'rare', affixes), CARDS, AFFIXES);

function rolls(name: string, count: number): OwnedCard[] {
  let rng = 12345;
  const out: OwnedCard[] = [];
  for (let i = 0; i < count; i++) {
    const drop = rollDrop(table(name), LOOT, CARDS, AFFIXES, `u${i}`, rng);
    rng = drop.rng;
    out.push(drop.card);
  }
  return out;
}

describe('affixes', () => {
  it('changes the card it resolves without touching the definition', () => {
    const before = JSON.stringify(CARDS.get('heavy-swing'));
    const card = resolve('heavy-swing', 'keen', 'thrifty', 'swift', 'barbed');
    expect(card.cost).toBe(2);
    expect(card.initiative).toBe(55);
    expect(card.effects[1]).toMatchObject({ kind: 'attack', damage: 7, conditions: ['bleed'] });
    expect(card.affixNames).toEqual(['Keen', 'Thrifty', 'Swift', 'Barbed']);
    expect(JSON.stringify(CARDS.get('heavy-swing'))).toBe(before);
  });

  it('only adds a fixed ability, and adds it after what is printed', () => {
    const card = resolve('flung-stone', 'warding');
    expect(card.effects.map((e) => e.kind)).toEqual(['attack', 'shield']);
  });

  it('keeps initiative in its legal range', () => {
    expect(resolve('guarded-stance', 'swift').initiative).toBe(1);
  });

  it('is only offered to cards it can change', () => {
    const offers = (id: string, rarity: DropRarity = 'fabled') =>
      eligibleAffixes(CARDS.get(id) as CardDef, rarity, [], AFFIXES).map((a) => a.id);
    expect(offers('guarded-stance')).not.toContain('keen');
    expect(offers('guarded-stance')).toContain('stalwart');
    expect(offers('ringing-blow')).not.toContain('stunning');
    expect(offers('wide-cleave')).not.toContain('far-reaching');
    expect(offers('flung-stone', 'common')).not.toContain('brutal');
  });

  it('fails loudly on an unknown affix or card', () => {
    expect(() => resolve('heavy-swing', 'nope')).toThrow(/Unknown affix/);
    expect(() => resolve('nope')).toThrow(/Unknown card/);
  });
});

describe('drops', () => {
  it('repeats exactly for the same random state', () => {
    expect(rolls('crypt', 50)).toEqual(rolls('crypt', 50));
  });

  it('follows the rules of each rarity', () => {
    for (const card of rolls('crypt', 2000)) {
      const rarity = card.rarity as DropRarity;
      const affixes = card.affixes.map((id) => AFFIXES.get(id) as AffixDef);
      expect(affixes.length).toBeLessThanOrEqual(LOOT.affixCounts[rarity]);
      expect(affixes.length).toBeGreaterThan(0);
      expect(new Set(affixes.map((a) => a.group)).size).toBe(affixes.length);
      const order = ['common', 'rare', 'fabled'];
      for (const a of affixes) expect(order.indexOf(a.minRarity)).toBeLessThanOrEqual(order.indexOf(rarity));
      const resolved = resolveCard(card, CARDS, AFFIXES);
      expect(resolved.cost).toBeGreaterThanOrEqual(0);
      expect(resolved.initiative).toBeGreaterThanOrEqual(1);
      expect(resolved.initiative).toBeLessThanOrEqual(99);
    }
  });

  it('rarely deals out identical copies', () => {
    const drops = rolls('crypt', 200).map((c) => `${c.defId}:${[...c.affixes].sort().join()}`);
    expect(new Set(drops).size).toBeGreaterThan(120);
  });

  it('gives better drops in more dangerous zones', () => {
    const score = (name: string) => rolls(name, 2000).filter((c) => c.rarity !== 'common').length;
    expect(score('crypt')).toBeGreaterThan(score('wilds') * 2);
    expect(rolls('wilds', 2000).some((c) => c.rarity === 'fabled')).toBe(false);
    expect(rolls('crypt', 2000).some((c) => c.rarity === 'fabled')).toBe(true);
  });
});

describe('loot data', () => {
  it('lets every card in every table roll at least one affix at each rarity it can have', () => {
    for (const t of Object.values(LOOT.tables)) {
      for (const { id } of t.cards) {
        for (const rarity of ['common', 'rare', 'fabled'] as const) {
          if (t.rarities[rarity] > 0) expect(eligibleAffixes(CARDS.get(id) as CardDef, rarity, [], AFFIXES).length, `${id} ${rarity}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps the starter deck legal and leaves some cards to find', () => {
    expect(STARTER_DECK.length).toBeGreaterThanOrEqual(TEST_WORLD.rules.minDeck);
    expect(STARTER_DECK.length).toBeLessThanOrEqual(TEST_WORLD.rules.maxDeck);
    expect(CARDS.size).toBeGreaterThan(STARTER_DECK.length);
  });

  it('rejects a table naming an unknown card and lists every problem', () => {
    const bad = {
      affixCounts: LOOT.affixCounts,
      tables: {
        a: { drops: 1, rarities: { common: 1, rare: 0, fabled: 0 }, cards: [{ id: 'nope', weight: 1 }] },
        b: { drops: 1, rarities: { common: 0, rare: 0, fabled: 0 }, cards: [{ id: 'heavy-swing', weight: 1 }] },
      },
    };
    expect(() => loadLoot(bad, CARDS)).toThrow(/a: unknown card "nope"[\s\S]*b: every rarity/);
  });
});

describe('keeping the better modifier', () => {
  const fight = (card: CardDef, draws: CombatState['playerModifiers']['draw']): CombatState => {
    const { state } = setup(['@d..'], Array.from({ length: 6 }, () => card));
    const next = JSON.parse(JSON.stringify(state)) as CombatState;
    next.playerModifiers.draw.push(...draws);
    return next;
  };
  const attackWith = (state: CombatState) => {
    const played = applyAction(state, { type: 'playCard', cardId: state.player.hand[0] as string });
    const target = played.state.figures.find((f) => f.faction === 'enemy') as CombatState['figures'][number];
    return applyAction(played.state, { type: 'attack', targetId: target.id }).events.find((e) => e.type === 'attacked');
  };
  const card: CardDef = {
    id: 't', name: 'T', initiative: 1, cost: 0, costType: 'stamina',
    effects: [{ kind: 'attack', damage: 2, range: 1, keepBetterModifier: true }],
  };

  it('uses the higher of two draws, whichever came first', () => {
    const plusTwo = { kind: 'add', value: 2 } as const;
    const minusOne = { kind: 'add', value: -1 } as const;
    expect(attackWith(fight(card, [minusOne, plusTwo]))).toMatchObject({ total: 4, modifier: plusTwo, discarded: minusOne });
    expect(attackWith(fight(card, [plusTwo, minusOne]))).toMatchObject({ total: 4, modifier: plusTwo, discarded: minusOne });
  });

  it('prefers a real hit to a null when both total zero', () => {
    const minusTwo = { kind: 'add', value: -2 } as const;
    expect(attackWith(fight(card, [minusTwo, { kind: 'null' }]))).toMatchObject({ total: 0, modifier: minusTwo });
    expect(attackWith(fight(card, [{ kind: 'null' }, minusTwo]))).toMatchObject({ total: 0, modifier: minusTwo });
  });

  it('draws only once without the property', () => {
    const plain: CardDef = { ...card, effects: [{ kind: 'attack', damage: 2, range: 1 }] };
    const event = attackWith(fight(plain, [{ kind: 'add', value: 2 }, { kind: 'add', value: 1 }]));
    expect(event).toMatchObject({ total: 3 });
    expect(event).not.toHaveProperty('discarded');
  });
});

describe('the game', () => {
  const rows = ['.......', '@......', '.......'];
  const layout = parseArena(rows, {});
  const encounter = (zone?: string): LevelDef['encounters'][number] => ({
    id: 'enc', area: { x: 1, y: 0, width: 6, height: 3 }, exits: [{ x: 1, y: 1 }],
    enemies: [{ defId: 'mire-skulker', pos: { x: 3, y: 1 } }], ...(zone && { zone }),
  });
  const world = (zone?: string): WorldDef => ({
    ...TEST_WORLD,
    levels: {
      a: {
        id: 'a', name: 'A', dark: false, width: layout.width, height: layout.height, tiles: layout.tiles,
        transitions: [], encounters: [encounter(zone)],
      },
    },
    start: { levelId: 'a', pos: layout.playerStart },
    enemies: [...ENEMIES.values()],
    basics: BASICS,
  });
  const step = (state: GameState, w: WorldDef, direction: 'east' | 'west' = 'east') =>
    applyGameAction(state, { type: 'step', direction }, w).state;

  /** Enters the fight next to the single enemy, with it one hit from death. */
  function nearWin(w: WorldDef, seed = 1): GameState {
    let state = step(step(newGame(w, seed), w), w);
    const combat = JSON.parse(JSON.stringify(state.combat)) as CombatState;
    const enemy = combat.figures.find((f) => f.faction === 'enemy') as CombatState['figures'][number];
    enemy.hp = 1;
    enemy.pos = { x: 3, y: 1 };
    combat.playerModifiers.draw.push({ kind: 'add', value: 0 });
    state = { ...state, combat };
    return state;
  }

  function win(start: GameState, w: WorldDef) {
    const played = applyGameAction(start, { type: 'combat', action: { type: 'useBasic', basic: 'attack' } }, w);
    const target = played.state.combat?.figures.find((f) => f.faction === 'enemy') as CombatState['figures'][number];
    return applyGameAction(played.state, { type: 'combat', action: { type: 'attack', targetId: target.id } }, w);
  }

  it('starts with plain copies of the starter deck, all in the deck', () => {
    const { character } = newGame(TEST_WORLD, 1);
    expect(character.collection).toHaveLength(STARTER_DECK.length);
    expect(character.collection.every((c) => c.rarity === 'plain' && c.affixes.length === 0)).toBe(true);
    expect(new Set(character.deck).size).toBe(STARTER_DECK.length);
  });

  it('rolls loot on winning, and only collects it when the fight screen closes', () => {
    const w = world('wilds');
    const won = win(nearWin(w), w);
    expect(won.state.combat?.phase).toMatchObject({ kind: 'ended', outcome: 'won' });
    expect(won.state.pendingLoot).toHaveLength(table('wilds').drops);
    expect(won.events.filter((e) => e.type === 'cardFound')).toHaveLength(table('wilds').drops);
    const before = won.state.character.collection.length;
    expect(before).toBe(STARTER_DECK.length);

    const finished = applyGameAction(won.state, { type: 'finishCombat' }, w).state;
    expect(finished.pendingLoot).toEqual([]);
    expect(finished.character.collection).toHaveLength(before + table('wilds').drops);
    expect(finished.character.deck).toHaveLength(STARTER_DECK.length);
    expect(JSON.parse(JSON.stringify(finished))).toEqual(finished);
  });

  it('gives each drop a unique id, and the same seed the same drop', () => {
    const w = world('crypt');
    const a = win(nearWin(w, 5), w).state.pendingLoot;
    const b = win(nearWin(w, 5), w).state.pendingLoot;
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(new Set(a.map((c) => c.uid)).size).toBe(2);
    const taken = newGame(w, 5).character.collection.map((c) => c.uid);
    for (const card of a) expect(taken).not.toContain(card.uid);
  });

  it('drops nothing where no zone is set', () => {
    const w = world();
    expect(win(nearWin(w), w).state.pendingLoot).toEqual([]);
  });

  it('drops nothing for fleeing', () => {
    const w = world('wilds');
    const fighting = step(step(newGame(w, 1), w), w);
    const combat = JSON.parse(JSON.stringify(fighting.combat)) as CombatState;
    const player = combat.figures[0] as CombatState['figures'][number];
    player.pos = { x: 1, y: 1 };
    const committed = applyGameAction({ ...fighting, combat }, { type: 'combat', action: { type: 'useBasic', basic: 'catchBreath' } }, w).state;
    const fled = applyGameAction(committed, { type: 'combat', action: { type: 'flee' } }, w);
    expect(fled.state.combat?.phase).toMatchObject({ kind: 'ended', outcome: 'fled' });
    expect(fled.state.pendingLoot).toEqual([]);
    expect(applyGameAction(fled.state, { type: 'finishCombat' }, w).state.character.collection).toHaveLength(STARTER_DECK.length);
  });

  it('fights with the rolled card, not its base numbers', () => {
    const w = world();
    const start = newGame(w, 1);
    const found = owned('heavy-swing', 'rare', ['brutal', 'barbed']);
    found.uid = 'found';
    const uids = start.character.deck.slice(0, 9);
    const state: GameState = {
      ...start,
      character: { ...start.character, collection: [...start.character.collection, found], deck: [...uids, 'found'] },
    };
    const fighting = step(step(state, w), w);
    const cards = Object.values(fighting.combat?.cards ?? {});
    expect(cards).toHaveLength(10);
    const swing = cards.find((c) => c.rarity === 'rare');
    expect(swing?.effects[1]).toMatchObject({ damage: 8, conditions: ['bleed'] });
    expect(swing?.affixNames).toEqual(['Brutal', 'Barbed']);
  });

  it('enforces deck size and ownership', () => {
    const w = world();
    let state = newGame(w, 1);
    const { minDeck, maxDeck } = w.rules;
    const remove = (s: GameState, uid: string) => applyGameAction(s, { type: 'removeFromDeck', uid }, w).state;
    const add = (s: GameState, uid: string) => applyGameAction(s, { type: 'addToDeck', uid }, w).state;

    while (state.character.deck.length > minDeck) state = remove(state, state.character.deck[0] as string);
    expect(() => remove(state, state.character.deck[0] as string)).toThrow(IllegalActionError);
    expect(() => add(state, state.character.deck[0] as string)).toThrow(/already in/);
    expect(() => add(state, 'nope')).toThrow(/don't own/);
    expect(() => remove(state, 'nope')).toThrow(/isn't in/);
    const spare = state.character.collection.find((c) => !state.character.deck.includes(c.uid)) as OwnedCard;
    const added = add(state, spare.uid);
    expect(added.character.deck).toContain(spare.uid);

    const extras = Array.from({ length: maxDeck + 1 }, (_, i) => ({ ...owned('heavy-swing', 'plain', []), uid: `e${i}` }));
    const stuffed: GameState = {
      ...state,
      character: { ...state.character, collection: extras, deck: extras.slice(0, maxDeck).map((c) => c.uid) },
    };
    expect(() => add(stuffed, `e${maxDeck}`)).toThrow(/full/);
  });

  it("won't change the deck during a fight", () => {
    const w = world();
    const fighting = step(step(newGame(w, 1), w), w);
    const uid = fighting.character.deck[0] as string;
    expect(() => applyGameAction(fighting, { type: 'removeFromDeck', uid }, w)).toThrow(IllegalActionError);
  });

  it('every encounter on the real map names a zone with a table', () => {
    const encounters = Object.values(WORLD.levels).flatMap((l) => l.encounters);
    expect(encounters.length).toBeGreaterThan(0);
    for (const e of encounters) expect(LOOT.tables[e.zone as string]).toBeDefined();
  });
});
