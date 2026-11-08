import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AFFIXES, BASICS, CARDS, ENEMIES, LEVELS, loadWorld, LOOT, newTestFight, STARTER_DECK, TEST_WORLD, WORLD } from '../src/content';
import { loadLdtkProject } from '../src/content/ldtk';
import { validateWorld } from '../src/content/validateWorld';
import { applyAction, applyGameAction, currentGrid, DEFAULT_WORLD_RULES, IllegalActionError, newGame, parseArena } from '../src/engine';
import type { Direction, GameState, LevelDef, WorldDef } from '../src/engine';

/** Builds a one-level world from ASCII. Encounter areas are given as rects. */
function makeWorld(rows: string[], encounters: LevelDef['encounters'] = [], dark = false): WorldDef {
  const layout = parseArena(rows, {});
  return {
    levels: {
      a: {
        id: 'a', name: 'A', dark, width: layout.width, height: layout.height, tiles: layout.tiles,
        transitions: [], encounters,
      },
    },
    start: { levelId: 'a', pos: layout.playerStart },
    character: { hp: 20, maxHp: 20, stamina: 10, maxStamina: 20, mana: 5, maxMana: 10, deck: STARTER_DECK.map((c) => c.id) },
    cards: CARDS, affixes: AFFIXES, loot: LOOT, progression: LEVELS, enemies: [...ENEMIES.values()], basics: BASICS, rules: DEFAULT_WORLD_RULES,
  };
}

const walk = (state: GameState, world: WorldDef, ...dirs: Direction[]): GameState =>
  dirs.reduce((s, direction) => applyGameAction(s, { type: 'step', direction }, world).state, state);

const SKULKER_ENCOUNTER: LevelDef['encounters'][number] = {
  id: 'enc', area: { x: 3, y: 0, width: 4, height: 3 },
  exits: [{ x: 3, y: 1 }], enemies: [{ defId: 'mire-skulker', pos: { x: 6, y: 1 } }],
};
const OPEN_ROWS = ['.......', '@......', '.......'];

describe('walking', () => {
  it('moves on walkable tiles and refuses blocked ones', () => {
    const world = makeWorld(['@.#', '~T.']);
    const state = newGame(world, 1);
    expect(walk(state, world, 'east').pos).toEqual({ x: 1, y: 0 });
    for (const direction of ['south', 'north', 'west'] as const) {
      expect(() => applyGameAction(state, { type: 'step', direction }, world)).toThrow(IllegalActionError);
    }
    const next = walk(state, world, 'east');
    expect(() => applyGameAction(next, { type: 'step', direction: 'east' }, world)).toThrow(/wall/);
    expect(() => applyGameAction(next, { type: 'step', direction: 'south' }, world)).toThrow(/tree/);
  });

  it('regenerates stamina and mana every few steps, but never health', () => {
    const world = makeWorld(['@.........']);
    let state = newGame(world, 1);
    state.character.hp = 10;
    state = walk(state, world, 'east', 'east', 'east');
    expect(state.character.stamina).toBe(10);
    state = walk(state, world, 'east');
    expect(state.character.stamina).toBe(11);
    expect(state.character.mana).toBe(6);
    expect(state.character.hp).toBe(10);
  });

  it('stops regen at the maximum', () => {
    const world = makeWorld(['@.........']);
    let state = newGame(world, 1);
    state.character.stamina = 20;
    state.character.mana = 10;
    state = walk(state, world, 'east', 'east', 'east', 'east');
    expect(state.character.stamina).toBe(20);
    expect(state.character.mana).toBe(10);
  });

  it('opens doors for good, which then stop blocking sight', () => {
    const world = makeWorld(['@+.']);
    const { state, events } = applyGameAction(newGame(world, 1), { type: 'step', direction: 'east' }, world);
    expect(events).toContainEqual({ type: 'doorOpened', pos: { x: 1, y: 0 } });
    expect(currentGrid(state, world).tiles[1]).toBe('openDoor');
    expect(world.levels.a?.tiles[1]).toBe('door');
  });

  it('springs a trap once, and a fatal trap ends the game', () => {
    const world = makeWorld(['@^.']);
    let state = newGame(world, 1);
    state = walk(state, world, 'east');
    expect(state.character.hp).toBe(18);
    expect(currentGrid(state, world).tiles[1]).toBe('floor');
    state = walk(state, world, 'west', 'east');
    expect(state.character.hp).toBe(18);

    const fatal = newGame(world, 1);
    fatal.character.hp = 2;
    const after = walk(fatal, world, 'east');
    expect(after.mode).toBe('dead');
    expect(() => applyGameAction(after, { type: 'step', direction: 'east' }, world)).toThrow(IllegalActionError);
  });

  it('changes level through a transition and back', () => {
    const base = makeWorld(['@..']);
    const a = base.levels.a as LevelDef;
    a.transitions = [{ tag: 'down', pos: { x: 2, y: 0 }, targetLevel: 'b', targetTag: 'up' }];
    const b: LevelDef = {
      ...a, id: 'b', name: 'B', transitions: [{ tag: 'up', pos: { x: 0, y: 0 }, targetLevel: 'a', targetTag: 'down' }],
    };
    const world = { ...base, levels: { a, b } };
    const state = walk(newGame(world, 1), world, 'east', 'east');
    expect(state.levelId).toBe('b');
    expect(state.pos).toEqual({ x: 0, y: 0 });
  });
});

describe('encounters', () => {
  const world = makeWorld(OPEN_ROWS, [SKULKER_ENCOUNTER]);

  it('starts when entering the area, keeping level coordinates and pools', () => {
    const before = walk(newGame(world, 1), world, 'north', 'east', 'east');
    expect(before.mode).toBe('explore');
    const { state, events } = applyGameAction(before, { type: 'step', direction: 'east' }, world);
    expect(state.mode).toBe('combat');
    expect(events).toContainEqual({ type: 'encounterStarted', encounterId: 'enc' });
    const combat = state.combat;
    expect(combat?.originX).toBe(3);
    expect(combat?.figures[0]?.pos).toEqual({ x: 3, y: 0 });
    expect(combat?.figures[1]?.pos).toEqual({ x: 6, y: 1 });
    // 10 and 5, plus the regen from the fourth step.
    expect(combat?.player.stamina).toBe(11);
    expect(combat?.player.mana).toBe(6);
  });

  it('does not start on an exit tile, and refuses walking while fighting', () => {
    const onExit = walk(newGame(world, 1), world, 'east', 'east', 'east');
    expect(onExit.pos).toEqual({ x: 3, y: 1 });
    expect(onExit.mode).toBe('explore');
    const fighting = walk(onExit, world, 'east');
    expect(fighting.mode).toBe('combat');
    expect(() => applyGameAction(fighting, { type: 'step', direction: 'east' }, world)).toThrow(IllegalActionError);
  });

  it('confines the fight to the area', () => {
    const fighting = walk(newGame(world, 1), world, 'east', 'east', 'east', 'east');
    const combat = fighting.combat;
    if (!combat) throw new Error('no fight');
    const { state } = applyAction(combat, { type: 'useBasic', basic: 'move' });
    // Anything outside the area behaves as wall, however open the map is.
    expect(() => applyAction(state, { type: 'move', to: { x: 3, y: 1 } })).not.toThrow();
    expect(state.tiles).toHaveLength(12);
  });

  /** Plays a fight to the end with simple choices until `done` says to stop. */
  const fightTo = (start: GameState, w: WorldDef, outcome: 'won' | 'fled'): GameState => {
    let state = start;
    if (!state.combat) throw new Error('no fight');
    if (outcome === 'won') {
      // Make the fight quick to finish; these tests are about what happens afterward.
      const combat = JSON.parse(JSON.stringify(state.combat)) as NonNullable<GameState['combat']>;
      for (const f of combat.figures) if (f.faction === 'enemy') f.hp = 1;
      state = { ...state, combat };
    }
    for (let i = 0; i < 300 && state.combat?.phase.kind !== 'ended'; i++) {
      const combat = state.combat as NonNullable<GameState['combat']>;
      const player = combat.figures[0] as NonNullable<typeof combat.figures[number]>;
      let action: Parameters<typeof applyAction>[1];
      if (combat.phase.kind === 'planning') {
        const distance = Math.min(...combat.figures.filter((f) => f.faction === 'enemy' && f.hp > 0)
          .map((f) => Math.abs(f.pos.x - player.pos.x) + Math.abs(f.pos.y - player.pos.y)));
        action = { type: 'useBasic', basic: outcome === 'fled' ? 'catchBreath' : distance <= 3 ? 'spark' : 'move' };
      } else if (outcome === 'fled') {
        action = combat.exits.some((e) => e.x === player.pos.x && e.y === player.pos.y) ? { type: 'flee' } : { type: 'skipEffect' };
      } else {
        const phase = combat.phase as Extract<typeof combat.phase, { kind: 'playerTurn' }>;
        const effect = phase.effects[phase.index];
        if (effect?.kind === 'attack') {
          const target = combat.figures.find((f) => f.faction === 'enemy' && f.hp > 0
            && Math.abs(f.pos.x - player.pos.x) + Math.abs(f.pos.y - player.pos.y) <= effect.range);
          action = target ? { type: 'attack', targetId: target.id } : { type: 'skipEffect' };
        } else if (effect?.kind === 'move') {
          const enemy = combat.figures.find((f) => f.faction === 'enemy' && f.hp > 0) as typeof player;
          const dx = Math.sign(enemy.pos.x - player.pos.x);
          action = { type: 'move', to: { x: player.pos.x + dx, y: player.pos.y } };
        } else action = { type: 'skipEffect' };
      }
      state = applyGameAction(state, { type: 'combat', action }, w).state;
    }
    return state;
  };

  it('needs a finished fight before leaving combat', () => {
    const fighting = walk(newGame(world, 1), world, 'east', 'east', 'east', 'east');
    expect(() => applyGameAction(fighting, { type: 'finishCombat' }, world)).toThrow(IllegalActionError);
  });

  it('winning clears the encounter for good and carries the character forward', () => {
    const fighting = walk(newGame(world, 3), world, 'east', 'east', 'east', 'east');
    const ended = fightTo(fighting, world, 'won');
    expect(ended.combat?.phase).toEqual({ kind: 'ended', outcome: 'won' });
    const combat = ended.combat as NonNullable<GameState['combat']>;
    const { state, events } = applyGameAction(ended, { type: 'finishCombat' }, world);
    expect(events[0]).toEqual({ type: 'combatFinished', outcome: 'won' });
    expect(events[1]).toMatchObject({ type: 'xpGained', amount: 4 });
    expect(state.mode).toBe('explore');
    expect(state.combat).toBeNull();
    expect(state.clearedEncounters).toEqual(['enc']);
    expect(state.character.stamina).toBe(combat.player.stamina);
    expect(state.character.mana).toBe(combat.player.mana);
    expect(state.character.hp).toBe(combat.figures[0]?.hp);
    expect(state.pos).toEqual(combat.figures[0]?.pos);
    // Free to walk the area now.
    expect(() => applyGameAction(state, { type: 'step', direction: state.pos.x > 3 ? 'west' : 'east' }, world)).not.toThrow();
  });

  it('fleeing leaves the enemies waiting, and they fight again on re-entry', () => {
    const onExit = walk(newGame(world, 1), world, 'east', 'east', 'east');
    const fighting = walk(onExit, world, 'east');
    const combat0 = fighting.combat as NonNullable<GameState['combat']>;
    // Stand on the exit, as a player who walked back to it would.
    const moved = JSON.parse(JSON.stringify(combat0)) as typeof combat0;
    (moved.figures[0] as { pos: object }).pos = { x: 3, y: 1 };
    const ended = fightTo({ ...fighting, combat: moved }, world, 'fled');
    if (ended.combat?.phase.kind !== 'ended') throw new Error('did not end');
    expect(ended.combat.phase.outcome).toBe('fled');
    const { state } = applyGameAction(ended, { type: 'finishCombat' }, world);
    expect(state.mode).toBe('explore');
    expect(state.clearedEncounters).toEqual([]);
    expect(state.pos).toEqual({ x: 3, y: 1 });
    expect(walk(state, world, 'east').mode).toBe('combat');
  });

  it('losing ends the game', () => {
    const fighting = walk(newGame(world, 1), world, 'east', 'east', 'east', 'east');
    const combat = JSON.parse(JSON.stringify(fighting.combat)) as NonNullable<GameState['combat']>;
    combat.phase = { kind: 'ended', outcome: 'lost' };
    (combat.figures[0] as { hp: number }).hp = 0;
    const { state } = applyGameAction({ ...fighting, combat }, { type: 'finishCombat' }, world);
    expect(state.mode).toBe('dead');
  });

  it('keeps tile changes made during a fight', () => {
    const fighting = walk(newGame(world, 1), world, 'east', 'east', 'east', 'east');
    const combat = JSON.parse(JSON.stringify(fighting.combat)) as NonNullable<GameState['combat']>;
    combat.phase = { kind: 'ended', outcome: 'fled' };
    combat.tiles[5] = 'openDoor'; // (4,1) in level coordinates.
    const { state } = applyGameAction({ ...fighting, combat }, { type: 'finishCombat' }, world);
    expect(currentGrid(state, world).tiles[1 * 7 + 4]).toBe('openDoor');
  });

  it('replays deterministically, including fight seeds', () => {
    const run = () => {
      let state = walk(newGame(world, 9), world, 'east', 'east', 'east', 'east');
      state = applyGameAction(state, { type: 'combat', action: { type: 'useBasic', basic: 'catchBreath' } }, world).state;
      return state;
    };
    expect(run()).toEqual(run());
  });

  it('the test fight starts already in combat', () => {
    const { state } = newTestFight(4);
    expect(state.mode).toBe('combat');
    expect(state.combat?.figures).toHaveLength(4);
    expect(TEST_WORLD.levels.test).toBeDefined();
  });
});

describe('map validation', () => {
  const ids = new Set(['mire-skulker']);
  const zones = new Set(['known']);
  const start = { levelId: 'a', pos: { x: 0, y: 1 } };
  const levelsOf = (rows: string[], encounters: LevelDef['encounters'] = []) => makeWorld(rows, encounters).levels;

  it('accepts a sound map', () => {
    expect(validateWorld(levelsOf(OPEN_ROWS, [SKULKER_ENCOUNTER]), start, ids, zones)).toEqual([]);
  });

  it.each([
    ['no exits', { ...SKULKER_ENCOUNTER, exits: [] }, /no exits/],
    ['no enemies', { ...SKULKER_ENCOUNTER, enemies: [] }, /no enemies/],
    ['an unknown enemy', { ...SKULKER_ENCOUNTER, enemies: [{ defId: 'nope', pos: { x: 6, y: 1 } }] }, /unknown enemy/],
    ['an enemy on an exit', { ...SKULKER_ENCOUNTER, enemies: [{ defId: 'mire-skulker', pos: { x: 3, y: 1 } }] }, /on an exit/],
    ['an area off the level', { ...SKULKER_ENCOUNTER, area: { x: 3, y: 0, width: 9, height: 3 } }, /runs off/],
    ['an unknown zone', { ...SKULKER_ENCOUNTER, zone: 'nowhere' }, /no loot table/],
    ['an area too big to show', { ...SKULKER_ENCOUNTER, area: { x: 0, y: 0, width: 15, height: 3 } }, /larger than/],
  ])('rejects %s', (_name, encounter, message) => {
    expect(validateWorld(levelsOf(OPEN_ROWS, [encounter]), start, ids, zones).join('\n')).toMatch(message);
  });

  it('rejects overlapping encounters', () => {
    const levels = levelsOf(OPEN_ROWS, [SKULKER_ENCOUNTER, { ...SKULKER_ENCOUNTER, id: 'other' }]);
    expect(validateWorld(levels, start, ids, zones).join('\n')).toMatch(/overlaps/);
  });

  it('rejects part of an area that has no way to an exit', () => {
    const rows = ['...#...', '@..#...', '...#...'];
    const encounter = { ...SKULKER_ENCOUNTER, area: { x: 0, y: 0, width: 7, height: 3 }, exits: [{ x: 0, y: 0 }] };
    expect(validateWorld(levelsOf(rows, [encounter]), start, ids, zones).join('\n')).toMatch(/no exit can be reached/);
  });

  it('rejects a broken transition and an unreachable level', () => {
    const levels = levelsOf(OPEN_ROWS);
    (levels.a as LevelDef).transitions = [{ tag: 't', pos: { x: 6, y: 0 }, targetLevel: 'gone', targetTag: 'x' }];
    levels.island = { ...(levels.a as LevelDef), id: 'island', transitions: [] };
    const errors = validateWorld(levels, start, ids, zones).join('\n');
    expect(errors).toMatch(/targets missing/);
    expect(errors).toMatch(/island: can't be reached/);
  });
});

describe('the real map', () => {
  const raw = readFileSync(new URL('../maps/world.ldtk', import.meta.url), 'utf8');

  it('loads and passes validation', () => {
    expect(() => loadWorld(raw)).not.toThrow();
    expect(Object.keys(WORLD.levels).sort()).toEqual(['Crypt', 'Wilds']);
  });

  it('has a dark dungeon and a lit overworld', () => {
    expect(WORLD.levels.Crypt?.dark).toBe(true);
    expect(WORLD.levels.Wilds?.dark).toBe(false);
  });

  it('reads terrain and entities in the right places', () => {
    const { levels, start } = loadLdtkProject(raw);
    const wilds = levels.Wilds as LevelDef;
    expect(start).toEqual({ levelId: 'Wilds', pos: { x: 4, y: 12 } });
    expect(wilds.tiles[12 * wilds.width + 4]).toBe('floor');
    expect(wilds.tiles[0]).toBe('tree');
    expect(wilds.encounters[0]?.exits).toHaveLength(2);
    expect(wilds.encounters[0]?.enemies[0]?.defId).toBe('mire-skulker');
  });

  it('treats unpainted cells as wall', () => {
    const project = JSON.parse(raw) as { levels: { layerInstances: { __identifier: string; intGridCsv: number[] }[] }[] };
    const crypt = project.levels[1]?.layerInstances.find((l) => l.__identifier === 'Terrain');
    if (!crypt) throw new Error('no terrain');
    expect(crypt.intGridCsv.includes(3)).toBe(true);
    crypt.intGridCsv[0] = 0;
    const { levels } = loadLdtkProject(JSON.stringify(project));
    expect(levels.Crypt?.tiles[0]).toBe('wall');
  });

  it('reports bad entity data clearly', () => {
    const project = JSON.parse(raw) as { levels: { layerInstances: { __identifier: string; entityInstances: { __identifier: string; fieldInstances: { __value: unknown }[] }[] }[] }[] };
    const entities = project.levels[0]?.layerInstances.find((l) => l.__identifier === 'Entities')?.entityInstances;
    const enemy = entities?.find((e) => e.__identifier === 'Enemy');
    if (!enemy?.fieldInstances[0]) throw new Error('no enemy');
    enemy.fieldInstances[0].__value = '';
    expect(() => loadLdtkProject(JSON.stringify(project))).toThrow(/needs a "defId"/);
  });
});
