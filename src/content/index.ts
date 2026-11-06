import { parseArena, type CombatSetup } from '../engine';
import { loadCards, loadEnemies } from './schemas';
import rawCards from './cards.json';
import rawEnemies from './enemies.json';

export const CARDS = loadCards(rawCards);
export const ENEMIES = loadEnemies(rawEnemies);

export const ENEMY_KEYS: Record<string, string> = { s: 'mire-skulker', a: 'hollow-archer' };

/** The hand-built test fight for the combat playtest gate. */
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

export const STARTER_DECK = [...CARDS.values()];

export function testFightSetup(seed: number): CombatSetup {
  return {
    seed,
    arena: parseArena(TEST_ARENA, ENEMY_KEYS),
    deck: STARTER_DECK,
    enemyDefs: [...ENEMIES.values()],
    player: { hp: 20, maxHp: 20, stamina: 20, maxStamina: 20 },
  };
}
