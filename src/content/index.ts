import { DEFAULT_WORLD_RULES, parseArena } from '../engine';
import type { GameState, LevelDef, StartingCharacter, WorldDef } from '../engine';
import { newGame, startEncounter } from '../engine';
import { loadLdtkProject } from './ldtk';
import { loadAffixes, loadBasics, loadCards, loadEnemies, loadLevels, loadLoot } from './schemas';
import { validateWorld } from './validateWorld';
import rawAffixes from './affixes.json';
import rawBasics from './basics.json';
import rawCards from './cards.json';
import rawEnemies from './enemies.json';
import rawLevels from './levels.json';
import rawLoot from './loot.json';
import rawStarter from './starter.json';
import rawWorld from '../../maps/world.ldtk?raw';

export const CARDS = loadCards(rawCards);
export const ENEMIES = loadEnemies(rawEnemies);
export const BASICS = loadBasics(rawBasics);
export const AFFIXES = loadAffixes(rawAffixes);
export const LOOT = loadLoot(rawLoot, CARDS);
export const LEVELS = loadLevels(rawLevels);

export const ENEMY_KEYS: Record<string, string> = { s: 'mire-skulker', a: 'hollow-archer' };

export const STARTER_DECK = rawStarter.map((id) => {
  const card = CARDS.get(id);
  if (!card) throw new Error(`The starter deck names unknown card "${id}"`);
  return card;
});

const STARTING_CHARACTER: StartingCharacter = {
  hp: 20, maxHp: 20, stamina: 20, maxStamina: 20, mana: 10, maxMana: 10,
  deck: STARTER_DECK.map((c) => c.id),
};

function buildWorld(levels: WorldDef['levels'], start: WorldDef['start']): WorldDef {
  return {
    levels, start, character: STARTING_CHARACTER, cards: CARDS, affixes: AFFIXES, loot: LOOT, progression: LEVELS,
    enemies: [...ENEMIES.values()], basics: BASICS, rules: DEFAULT_WORLD_RULES,
  };
}

/** Throws with every problem listed, so a bad map fails loudly at startup and in tests. */
export function loadWorld(raw: string): WorldDef {
  const { levels, start } = loadLdtkProject(raw);
  const errors = validateWorld(levels, start, new Set(ENEMIES.keys()), new Set(Object.keys(LOOT.tables)));
  if (errors.length > 0) throw new Error(`The map has problems:\n- ${errors.join('\n- ')}`);
  return buildWorld(levels, start);
}

export const WORLD = loadWorld(rawWorld);

/** The hand-built fight used for combat playtesting: open with `?fight=test`. */
export const TEST_ARENA = [
  '##############',
  '#E...#....a..#',
  '#....#.......#',
  '#.......^....#',
  '#@..~~...s...#',
  '#...~~.......#',
  '#.......^....#',
  '#....#.......#',
  '#E...#....s..#',
  '##############',
];

const testLayout = parseArena(TEST_ARENA, ENEMY_KEYS);
const TEST_LEVEL: LevelDef = {
  id: 'test', name: 'Test Arena', dark: false, width: testLayout.width, height: testLayout.height,
  tiles: testLayout.tiles,
  transitions: [],
  encounters: [{
    id: 'test',
    area: { x: 0, y: 0, width: testLayout.width, height: testLayout.height },
    exits: testLayout.exits,
    enemies: testLayout.enemies,
  }],
};

export const TEST_WORLD = buildWorld({ test: TEST_LEVEL }, { levelId: 'test', pos: testLayout.playerStart });

/** A new game already inside the test fight, with no walking first. */
export function newTestFight(seed: number): { state: GameState; events: Parameters<typeof startEncounter>[3] } {
  const state = newGame(TEST_WORLD, seed);
  const events: Parameters<typeof startEncounter>[3] = [];
  startEncounter(state, TEST_LEVEL.encounters[0] as LevelDef['encounters'][number], TEST_WORLD, events);
  return { state, events };
}

/** The test fight as a bare combat setup, for headless balance and determinism runs. */
export function testFightSetup(seed: number) {
  return {
    seed,
    arena: testLayout,
    deck: STARTER_DECK,
    enemyDefs: [...ENEMIES.values()],
    basics: BASICS,
    player: { hp: 20, maxHp: 20, stamina: 20, maxStamina: 20, mana: 10, maxMana: 10 },
  };
}
