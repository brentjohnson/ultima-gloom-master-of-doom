import { applyAction, createCombat, DEFAULT_RULES, getPlayer, PLAYER_ID } from './combat';
import { samePos, tileAt } from './grid';
import { nextRandom } from './rng';
import { IllegalActionError, TILE_PROPS } from './types';
import type {
  Action, BasicDef, BasicId, CardDef, CombatState, EnemyDef, GameEvent, Outcome, Pos, ResourceKind, Tile, TileGrid,
} from './types';

export interface Rect { x: number; y: number; width: number; height: number }

export interface EncounterDef {
  id: string;
  /** The fight is confined to this rectangle, and entering it starts the fight. */
  area: Rect;
  /** Tiles in the area that never trigger the fight and can be fled from. */
  exits: Pos[];
  enemies: { defId: string; pos: Pos }[];
}

export interface TransitionDef { tag: string; pos: Pos; targetLevel: string; targetTag: string }

export interface LevelDef {
  id: string;
  name: string;
  dark: boolean;
  width: number;
  height: number;
  tiles: Tile[];
  transitions: TransitionDef[];
  encounters: EncounterDef[];
}

export interface Character {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;
  /** Card definition ids. */
  deck: string[];
}

export interface WorldRules {
  /** Walking this many steps regenerates the amounts below. */
  stepsPerRegen: number;
  walkRegenStamina: number;
  walkRegenMana: number;
}

export const DEFAULT_WORLD_RULES: WorldRules = { stepsPerRegen: 4, walkRegenStamina: 1, walkRegenMana: 1 };

/** Everything fixed about the world. Game state refers to it by id and is never copied from it. */
export interface WorldDef {
  levels: Record<string, LevelDef>;
  start: { levelId: string; pos: Pos };
  character: Character;
  cards: Map<string, CardDef>;
  enemies: EnemyDef[];
  basics: Record<BasicId, BasicDef>;
  rules: WorldRules;
}

export interface GameState {
  rng: number;
  character: Character;
  levelId: string;
  pos: Pos;
  steps: number;
  /** Tiles changed from their authored state, by level and tile index. */
  tileChanges: Record<string, Record<number, Tile>>;
  clearedEncounters: string[];
  mode: 'explore' | 'combat' | 'dead';
  combat: CombatState | null;
  encounterId: string | null;
}

export type Direction = 'north' | 'east' | 'south' | 'west';

export type GameAction =
  | { type: 'step'; direction: Direction }
  | { type: 'combat'; action: Action }
  /** Leaves the end-of-fight screen and applies the result to the character. */
  | { type: 'finishCombat' };

export type WorldEvent =
  | { type: 'stepped'; from: Pos; to: Pos }
  | { type: 'levelChanged'; levelId: string; pos: Pos }
  | { type: 'encounterStarted'; encounterId: string }
  | { type: 'combatFinished'; outcome: Outcome };

export type AnyEvent = GameEvent | WorldEvent;
export interface GameResult { state: GameState; events: AnyEvent[] }

const DELTAS: Record<Direction, Pos> = {
  north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
};

export const rectContains = (r: Rect, p: Pos): boolean =>
  p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;

export function newGame(world: WorldDef, seed: number): GameState {
  return {
    rng: seed | 0,
    character: { ...world.character, deck: [...world.character.deck] },
    levelId: world.start.levelId,
    pos: { ...world.start.pos },
    steps: 0,
    tileChanges: {},
    clearedEncounters: [],
    mode: 'explore',
    combat: null,
    encounterId: null,
  };
}

function levelOf(state: GameState, world: WorldDef): LevelDef {
  const level = world.levels[state.levelId];
  if (!level) throw new Error(`Unknown level "${state.levelId}"`);
  return level;
}

/** The current level's tiles, including lasting changes and any fight in progress. */
export function currentGrid(state: GameState, world: WorldDef): TileGrid {
  const level = levelOf(state, world);
  const tiles = [...level.tiles];
  for (const [index, tile] of Object.entries(state.tileChanges[state.levelId] ?? {})) tiles[Number(index)] = tile;
  const combat = state.combat;
  if (combat) {
    combat.tiles.forEach((tile, i) => {
      const x = combat.originX + (i % combat.width);
      const y = combat.originY + Math.floor(i / combat.width);
      tiles[y * level.width + x] = tile;
    });
  }
  return { originX: 0, originY: 0, width: level.width, height: level.height, tiles };
}

export const liveEncounters = (state: GameState, world: WorldDef): EncounterDef[] =>
  levelOf(state, world).encounters.filter((e) => !state.clearedEncounters.includes(e.id));

export function applyGameAction(previous: GameState, action: GameAction, world: WorldDef): GameResult {
  switch (action.type) {
    case 'combat': {
      if (previous.mode !== 'combat' || !previous.combat) throw new IllegalActionError('combat: no fight in progress');
      const result = applyAction(previous.combat, action.action);
      return { state: { ...previous, combat: result.state }, events: result.events };
    }
    case 'finishCombat':
      return finishCombat(previous, world);
    case 'step':
      return step(previous, action.direction, world);
  }
}

function step(previous: GameState, direction: Direction, world: WorldDef): GameResult {
  if (previous.mode !== 'explore') throw new IllegalActionError('step: not exploring');
  const delta = DELTAS[direction];
  const to = { x: previous.pos.x + delta.x, y: previous.pos.y + delta.y };
  const grid = currentGrid(previous, world);
  const tile = tileAt(grid, to);
  if (!TILE_PROPS[tile].walkable) throw new IllegalActionError(`step: ${tile} blocks the way`);
  const encounters = liveEncounters(previous, world);
  if (encounters.some((e) => e.enemies.some((enemy) => samePos(enemy.pos, to)))) {
    throw new IllegalActionError('step: an enemy blocks the way');
  }

  const state = JSON.parse(JSON.stringify(previous)) as GameState;
  const level = levelOf(state, world);
  const index = to.y * level.width + to.x;
  const events: AnyEvent[] = [{ type: 'stepped', from: previous.pos, to }];
  state.pos = to;
  state.steps += 1;

  if (tile === 'door') {
    setTileChange(state, index, 'openDoor');
    events.push({ type: 'doorOpened', pos: to });
  } else if (tile === 'trap') {
    setTileChange(state, index, 'floor');
    events.push({ type: 'trapSprung', pos: to, figureId: PLAYER_ID });
    const c = state.character;
    c.hp = Math.max(0, c.hp - DEFAULT_RULES.trapDamage);
    events.push({ type: 'damaged', figureId: PLAYER_ID, amount: DEFAULT_RULES.trapDamage, blocked: 0, hp: c.hp, source: 'trap' });
    if (c.hp === 0) {
      events.push({ type: 'defeated', figureId: PLAYER_ID, name: 'You' });
      state.mode = 'dead';
      return { state, events };
    }
  }

  if (state.steps % world.rules.stepsPerRegen === 0) {
    regen(state.character, 'stamina', world.rules.walkRegenStamina, events);
    regen(state.character, 'mana', world.rules.walkRegenMana, events);
  }

  const transition = level.transitions.find((t) => samePos(t.pos, to));
  if (transition) {
    const target = world.levels[transition.targetLevel]?.transitions.find((t) => t.tag === transition.targetTag);
    if (!target) throw new Error(`Transition "${transition.tag}" has no target`);
    state.levelId = transition.targetLevel;
    state.pos = { ...target.pos };
    events.push({ type: 'levelChanged', levelId: state.levelId, pos: state.pos });
    return { state, events };
  }

  const encounter = encounters.find((e) => rectContains(e.area, to) && !e.exits.some((exit) => samePos(exit, to)));
  if (encounter) startEncounter(state, encounter, world, events);
  return { state, events };
}

function regen(c: Character, resource: ResourceKind, amount: number, events: AnyEvent[]): void {
  const max = resource === 'stamina' ? c.maxStamina : c.maxMana;
  const delta = Math.min(amount, max - c[resource]);
  if (delta <= 0) return;
  c[resource] += delta;
  events.push({ type: 'resourceChanged', resource, delta, value: c[resource], source: 'regen' });
}

function setTileChange(state: GameState, index: number, tile: Tile): void {
  (state.tileChanges[state.levelId] ??= {})[index] = tile;
}

/** Starts a fight in place. Mutates `state`, which the caller owns. */
export function startEncounter(state: GameState, encounter: EncounterDef, world: WorldDef, events: AnyEvent[]): void {
  const { area } = encounter;
  const grid = currentGrid(state, world);
  const tiles: Tile[] = [];
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) tiles.push(tileAt(grid, { x, y }));
  }
  const random = nextRandom(state.rng);
  state.rng = random.rng;

  const c = state.character;
  const deck = c.deck.map((id) => {
    const card = world.cards.get(id);
    if (!card) throw new Error(`Unknown card "${id}"`);
    return card;
  });
  const created = createCombat({
    seed: Math.floor(random.value * 2 ** 31),
    arena: {
      originX: area.x, originY: area.y, width: area.width, height: area.height, tiles,
      exits: encounter.exits, playerStart: state.pos, enemies: encounter.enemies,
    },
    deck,
    enemyDefs: world.enemies,
    basics: world.basics,
    player: { hp: c.hp, maxHp: c.maxHp, stamina: c.stamina, maxStamina: c.maxStamina, mana: c.mana, maxMana: c.maxMana },
  });
  state.mode = 'combat';
  state.combat = created.state;
  state.encounterId = encounter.id;
  events.push({ type: 'encounterStarted', encounterId: encounter.id }, ...created.events);
}

function finishCombat(previous: GameState, world: WorldDef): GameResult {
  const combat = previous.combat;
  if (previous.mode !== 'combat' || !combat || combat.phase.kind !== 'ended') {
    throw new IllegalActionError('finishCombat: no finished fight');
  }
  const { outcome } = combat.phase;
  const state = JSON.parse(JSON.stringify(previous)) as GameState;
  const player = getPlayer(combat);
  const c = state.character;
  c.hp = player.hp;
  c.stamina = combat.player.stamina;
  c.mana = combat.player.mana;
  state.pos = { ...player.pos };

  // Sprung traps and opened doors outlast the fight.
  const level = levelOf(state, world);
  const before = currentGrid({ ...state, combat: null }, world);
  combat.tiles.forEach((tile, i) => {
    const x = combat.originX + (i % combat.width);
    const y = combat.originY + Math.floor(i / combat.width);
    const index = y * level.width + x;
    if (before.tiles[index] !== tile) setTileChange(state, index, tile);
  });

  if (outcome === 'won' && state.encounterId) state.clearedEncounters.push(state.encounterId);
  state.mode = outcome === 'lost' ? 'dead' : 'explore';
  state.combat = null;
  state.encounterId = null;
  return { state, events: [{ type: 'combatFinished', outcome }] };
}
