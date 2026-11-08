import { describe, expect, it } from 'vitest';
import { BASICS, ENEMIES, LEVELS, TEST_WORLD } from '../src/content';
import { loadLevels } from '../src/content/schemas';
import {
  applyGameAction, basicUpgradeOptions, characterBasics, IllegalActionError, levelForXp, newGame, nextThreshold, parseArena,
  pendingLevelUps, upgradedBasics,
} from '../src/engine';
import type { BasicUpgrade, CombatState, GameState, LevelDef, WorldDef } from '../src/engine';

const rows = ['.........', '@........', '.........'];
const layout = parseArena(rows, {});
const world: WorldDef = {
  ...TEST_WORLD,
  levels: {
    a: {
      id: 'a', name: 'A', dark: false, width: layout.width, height: layout.height, tiles: layout.tiles, transitions: [],
      encounters: [{
        id: 'enc', area: { x: 1, y: 0, width: 8, height: 3 }, exits: [{ x: 1, y: 1 }],
        enemies: [{ defId: 'mire-skulker', pos: { x: 3, y: 1 } }, { defId: 'hollow-archer', pos: { x: 7, y: 1 } }],
      }] satisfies LevelDef['encounters'],
    },
  },
  start: { levelId: 'a', pos: layout.playerStart },
};
const skulkerXp = ENEMIES.get('mire-skulker')?.xp as number;
const archerXp = ENEMIES.get('hollow-archer')?.xp as number;

const act = (state: GameState, action: Parameters<typeof applyGameAction>[1]) => applyGameAction(state, action, world);
const stepEast = (state: GameState) => act(state, { type: 'step', direction: 'east' }).state;

/** Starts the fight, then ends it as given, with `killed` enemies dead. */
function endFight(outcome: 'won' | 'fled', killed: number, start = newGame(world, 1)): GameState {
  const fighting = stepEast(stepEast(start));
  const combat = JSON.parse(JSON.stringify(fighting.combat)) as CombatState;
  combat.figures.filter((f) => f.faction === 'enemy').forEach((f, i) => { if (i < killed) f.hp = 0; });
  combat.phase = { kind: 'ended', outcome };
  return { ...fighting, combat };
}

const finish = (state: GameState) => act(state, { type: 'finishCombat' });
const sparkRange: BasicUpgrade = { basic: 'spark', kind: 'stat', effectIndex: 0, stat: 'range' };

describe('experience', () => {
  it('pays for each enemy killed in a won fight, by its own value', () => {
    const { state, events } = finish(endFight('won', 2));
    expect(state.character.xp).toBe(skulkerXp + archerXp);
    expect(events).toContainEqual(expect.objectContaining({ type: 'xpGained', amount: skulkerXp + archerXp }));
  });

  it('pays nothing for fleeing, even after a kill, since the enemies return', () => {
    expect(finish(endFight('fled', 1)).state.character.xp).toBe(0);
  });

  it("doesn't depend on the player's level", () => {
    const seasoned = newGame(world, 1);
    seasoned.character = { ...seasoned.character, level: 5, xp: 100 };
    expect(finish(endFight('won', 2, seasoned)).state.character.xp - 100).toBe(skulkerXp + archerXp);
  });

  it('needs more XP for each level, and caps at the end of the table', () => {
    const gaps = LEVELS.thresholds.map((t, i) => t - (LEVELS.thresholds[i - 1] ?? 0));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1] as number);
    expect(levelForXp(0, LEVELS)).toBe(1);
    expect(levelForXp((LEVELS.thresholds[0] as number) - 1, LEVELS)).toBe(1);
    expect(levelForXp(LEVELS.thresholds[0] as number, LEVELS)).toBe(2);
    expect(levelForXp(1e9, LEVELS)).toBe(LEVELS.thresholds.length + 1);
    expect(nextThreshold(LEVELS.thresholds.length + 1, LEVELS)).toBeNull();
  });

  it('rejects thresholds that do not rise', () => {
    expect(() => loadLevels({ ...LEVELS, thresholds: [10, 10] })).toThrow(/rise/);
  });
});

describe('leveling up', () => {
  const earned = (): GameState => {
    const state = newGame(world, 1);
    state.character = { ...state.character, xp: LEVELS.thresholds[0] as number };
    return state;
  };

  it('holds walking until the level is taken', () => {
    const state = earned();
    expect(pendingLevelUps(state.character, world)).toBe(1);
    expect(() => stepEast(state)).toThrow(IllegalActionError);
  });

  it('grows exactly one pool, current value included, and upgrades exactly one basic action', () => {
    const before = earned();
    const { state, events } = act(before, { type: 'levelUp', pool: 'mana', upgrade: sparkRange });
    const c = state.character;
    expect(c.level).toBe(2);
    expect(c.maxMana).toBe(before.character.maxMana + LEVELS.poolGrowth.mana);
    expect(c.mana).toBe(before.character.mana + LEVELS.poolGrowth.mana);
    expect(c.maxHp).toBe(before.character.maxHp);
    expect(c.maxStamina).toBe(before.character.maxStamina);
    expect(characterBasics(c, world).spark.effects[0]).toMatchObject({ damage: 1, range: 4 });
    expect(characterBasics(c, world).attack).toEqual(BASICS.attack);
    expect(events).toEqual([{ type: 'leveledUp', level: 2, pool: 'mana', growth: LEVELS.poolGrowth.mana, upgrade: sparkRange }]);
    expect(() => stepEast(state)).not.toThrow();
  });

  it('refuses a level not yet earned, or an upgrade that does not exist', () => {
    expect(() => act(newGame(world, 1), { type: 'levelUp', pool: 'hp', upgrade: sparkRange })).toThrow(/no level/);
    const bogus = { basic: 'move', kind: 'stat', effectIndex: 0, stat: 'damage' } as const;
    expect(() => act(earned(), { type: 'levelUp', pool: 'hp', upgrade: bogus })).toThrow(/not available/);
  });

  it('takes several earned levels one at a time', () => {
    let state = newGame(world, 1);
    state.character = { ...state.character, xp: LEVELS.thresholds[1] as number };
    expect(pendingLevelUps(state.character, world)).toBe(2);
    state = act(state, { type: 'levelUp', pool: 'hp', upgrade: { basic: 'move', kind: 'initiative' } }).state;
    state = act(state, { type: 'levelUp', pool: 'hp', upgrade: { basic: 'move', kind: 'initiative' } }).state;
    expect(pendingLevelUps(state.character, world)).toBe(0);
    expect(state.character.maxHp).toBe(TEST_WORLD.character.maxHp + 2 * LEVELS.poolGrowth.hp);
    expect(characterBasics(state.character, world).move.initiative).toBe(BASICS.move.initiative - 2 * LEVELS.initiativeStep);
  });

  it('brings upgraded basics into fights, and leaves cards alone', () => {
    const leveled = act(earned(), { type: 'levelUp', pool: 'stamina', upgrade: { basic: 'attack', kind: 'stat', effectIndex: 0, stat: 'damage' } }).state;
    const fighting = stepEast(stepEast(leveled));
    expect(fighting.combat?.basics.attack.effects[0]).toMatchObject({ damage: 3 });
    const fresh = stepEast(stepEast(newGame(world, 1)));
    expect(fighting.combat?.cards).toEqual(fresh.combat?.cards);
  });
});

describe('basic action upgrades', () => {
  it('offers +1 to each number and a faster initiative for every basic action', () => {
    const labels = basicUpgradeOptions(BASICS, LEVELS).map((o) => (o.kind === 'stat' ? `${o.basic}.${o.stat}` : `${o.basic}.init`));
    expect(labels.sort()).toEqual([
      'attack.damage', 'attack.init', 'attack.range', 'catchBreath.init', 'catchBreath.mana', 'catchBreath.stamina',
      'move.init', 'move.range', 'spark.damage', 'spark.init', 'spark.range',
    ]);
  });

  it('stops offering initiative once it would drop below 1', () => {
    const fast = upgradedBasics(BASICS, Array.from({ length: 8 }, () => ({ basic: 'move', kind: 'initiative' }) as const), LEVELS);
    expect(fast.move.initiative).toBe(10);
    expect(basicUpgradeOptions(fast, LEVELS).some((o) => o.basic === 'move' && o.kind === 'initiative')).toBe(false);
  });

  it('never changes the base definitions', () => {
    const before = JSON.stringify(BASICS);
    upgradedBasics(BASICS, [sparkRange, { basic: 'spark', kind: 'initiative' }], LEVELS);
    expect(JSON.stringify(BASICS)).toBe(before);
  });
});
