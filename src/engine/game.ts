import { applyAction, createCombat, DEFAULT_RULES, getPlayer, PLAYER_ID } from './combat';
import { samePos, tileAt } from './grid';
import { resolveCard, rollDrop } from './loot';
import type { AffixDef, LootData, OwnedCard } from './loot';
import { basicUpgradeOptions, levelForXp, sameUpgrade, upgradedBasics } from './progression';
import type { BasicUpgrade, LevelRules, Pool } from './progression';
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
  /** Names the loot table for winning this fight. Without one, nothing drops. */
  zone?: string;
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
  /** Every card the character owns, whether in the deck or not. */
  collection: OwnedCard[];
  /** Uids from the collection. */
  deck: string[];
  /** Levels taken. XP can be ahead of this until the level-up choices are made. */
  level: number;
  xp: number;
  /** Every basic action upgrade taken, in order. */
  basicUpgrades: BasicUpgrade[];
}

/** A new character. `deck` lists card definition ids, each of which becomes a plain owned copy. */
export type StartingCharacter = Omit<Character, 'collection' | 'level' | 'xp' | 'basicUpgrades'>;

export interface WorldRules {
  /** Walking this many steps regenerates the amounts below. */
  stepsPerRegen: number;
  walkRegenStamina: number;
  walkRegenMana: number;
  minDeck: number;
  maxDeck: number;
}

export const DEFAULT_WORLD_RULES: WorldRules = { stepsPerRegen: 4, walkRegenStamina: 1, walkRegenMana: 1, minDeck: 10, maxDeck: 20 };

/** Everything fixed about the world. Game state refers to it by id and is never copied from it. */
export interface WorldDef {
  levels: Record<string, LevelDef>;
  start: { levelId: string; pos: Pos };
  character: StartingCharacter;
  cards: Map<string, CardDef>;
  affixes: Map<string, AffixDef>;
  loot: LootData;
  progression: LevelRules;
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
  /** Used to give each owned card a unique id. */
  nextCardNumber: number;
  /** Rolled when a fight is won, and collected when the end-of-fight screen closes. */
  pendingLoot: OwnedCard[];
  mode: 'explore' | 'combat' | 'dead';
  combat: CombatState | null;
  encounterId: string | null;
}

export type Direction = 'north' | 'east' | 'south' | 'west';

export type GameAction =
  | { type: 'step'; direction: Direction }
  | { type: 'combat'; action: Action }
  /** Leaves the end-of-fight screen and applies the result to the character. */
  | { type: 'finishCombat' }
  /** Deck editing, allowed whenever you aren't in a fight. */
  | { type: 'addToDeck'; uid: string }
  | { type: 'removeFromDeck'; uid: string }
  /** Takes one earned level: grow one pool and upgrade one basic action. */
  | { type: 'levelUp'; pool: Pool; upgrade: BasicUpgrade };

export type WorldEvent =
  | { type: 'stepped'; from: Pos; to: Pos }
  | { type: 'levelChanged'; levelId: string; pos: Pos }
  | { type: 'encounterStarted'; encounterId: string }
  | { type: 'combatFinished'; outcome: Outcome }
  | { type: 'cardFound'; card: OwnedCard }
  | { type: 'xpGained'; amount: number; xp: number; levelsEarned: number }
  | { type: 'leveledUp'; level: number; pool: Pool; growth: number; upgrade: BasicUpgrade };

export type AnyEvent = GameEvent | WorldEvent;
export interface GameResult { state: GameState; events: AnyEvent[] }

const DELTAS: Record<Direction, Pos> = {
  north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
};

export const rectContains = (r: Rect, p: Pos): boolean =>
  p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;

export function newGame(world: WorldDef, seed: number): GameState {
  const collection: OwnedCard[] = world.character.deck.map((defId, i) => ({ uid: `card-${i}`, defId, rarity: 'plain', affixes: [] }));
  return {
    rng: seed | 0,
    character: { ...world.character, collection, deck: collection.map((card) => card.uid), level: 1, xp: 0, basicUpgrades: [] },
    levelId: world.start.levelId,
    pos: { ...world.start.pos },
    steps: 0,
    tileChanges: {},
    clearedEncounters: [],
    nextCardNumber: collection.length,
    pendingLoot: [],
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
      const events: AnyEvent[] = [...result.events];
      const state = { ...previous, combat: result.state };
      const justWon = result.state.phase.kind === 'ended' && result.state.phase.outcome === 'won' && previous.combat.phase.kind !== 'ended';
      return { state: justWon ? rollLoot(state, world, events) : state, events };
    }
    case 'finishCombat':
      return finishCombat(previous, world);
    case 'step':
      return step(previous, action.direction, world);
    case 'addToDeck':
      return addToDeck(previous, action.uid, world);
    case 'removeFromDeck':
      return removeFromDeck(previous, action.uid, world);
    case 'levelUp':
      return levelUp(previous, action.pool, action.upgrade, world);
  }
}

function rollLoot(previous: GameState, world: WorldDef, events: AnyEvent[]): GameState {
  const zone = levelOf(previous, world).encounters.find((e) => e.id === previous.encounterId)?.zone;
  if (!zone) return previous;
  const table = world.loot.tables[zone];
  if (!table) throw new Error(`No loot table for zone "${zone}"`);
  let { rng, nextCardNumber } = previous;
  const pendingLoot: OwnedCard[] = [];
  for (let i = 0; i < table.drops; i++) {
    const drop = rollDrop(table, world.loot, world.cards, world.affixes, `card-${nextCardNumber}`, rng);
    rng = drop.rng;
    nextCardNumber += 1;
    pendingLoot.push(drop.card);
    events.push({ type: 'cardFound', card: drop.card });
  }
  return { ...previous, rng, nextCardNumber, pendingLoot };
}

/** Levels earned but not yet taken. Walking waits until they are. */
export const pendingLevelUps = (c: Character, world: WorldDef): number => levelForXp(c.xp, world.progression) - c.level;

/** The basic actions as this character has upgraded them. */
export const characterBasics = (c: Character, world: WorldDef) => upgradedBasics(world.basics, c.basicUpgrades, world.progression);

const POOL_MAX = { hp: 'maxHp', stamina: 'maxStamina', mana: 'maxMana' } as const;

function levelUp(previous: GameState, pool: Pool, upgrade: BasicUpgrade, world: WorldDef): GameResult {
  if (previous.mode !== 'explore') throw new IllegalActionError('levelUp: not now');
  if (pendingLevelUps(previous.character, world) <= 0) throw new IllegalActionError('levelUp: no level earned');
  const options = basicUpgradeOptions(characterBasics(previous.character, world), world.progression);
  if (!options.some((o) => sameUpgrade(o, upgrade))) throw new IllegalActionError('levelUp: that upgrade is not available');
  const growth = world.progression.poolGrowth[pool];
  const c = { ...previous.character, basicUpgrades: [...previous.character.basicUpgrades, upgrade], level: previous.character.level + 1 };
  // Growing a pool raises its current value too, so the new capacity is usable at once.
  c[POOL_MAX[pool]] += growth;
  c[pool] += growth;
  return { state: { ...previous, character: c }, events: [{ type: 'leveledUp', level: c.level, pool, growth, upgrade }] };
}

function editableCharacter(state: GameState): Character {
  if (state.mode !== 'explore') throw new IllegalActionError('deck: can only be changed outside a fight');
  return state.character;
}

function addToDeck(previous: GameState, uid: string, world: WorldDef): GameResult {
  const c = editableCharacter(previous);
  if (!c.collection.some((card) => card.uid === uid)) throw new IllegalActionError(`deck: you don't own ${uid}`);
  if (c.deck.includes(uid)) throw new IllegalActionError(`deck: ${uid} is already in the deck`);
  if (c.deck.length >= world.rules.maxDeck) throw new IllegalActionError('deck: already full');
  return { state: { ...previous, character: { ...c, deck: [...c.deck, uid] } }, events: [] };
}

function removeFromDeck(previous: GameState, uid: string, world: WorldDef): GameResult {
  const c = editableCharacter(previous);
  if (!c.deck.includes(uid)) throw new IllegalActionError(`deck: ${uid} isn't in the deck`);
  if (c.deck.length <= world.rules.minDeck) throw new IllegalActionError('deck: already at the minimum size');
  return { state: { ...previous, character: { ...c, deck: c.deck.filter((id) => id !== uid) } }, events: [] };
}

function step(previous: GameState, direction: Direction, world: WorldDef): GameResult {
  if (previous.mode !== 'explore') throw new IllegalActionError('step: not exploring');
  if (pendingLevelUps(previous.character, world) > 0) throw new IllegalActionError('step: choose your level-up first');
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
  const deck = c.deck.map((uid) => {
    const owned = c.collection.find((card) => card.uid === uid);
    if (!owned) throw new Error(`The deck holds "${uid}", which isn't in the collection`);
    return resolveCard(owned, world.cards, world.affixes);
  });
  const created = createCombat({
    seed: Math.floor(random.value * 2 ** 31),
    arena: {
      originX: area.x, originY: area.y, width: area.width, height: area.height, tiles,
      exits: encounter.exits, playerStart: state.pos, enemies: encounter.enemies,
    },
    deck,
    enemyDefs: world.enemies,
    basics: characterBasics(c, world),
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

  const events: AnyEvent[] = [{ type: 'combatFinished', outcome }];
  if (outcome === 'won' && state.encounterId) {
    state.clearedEncounters.push(state.encounterId);
    // Only a won fight pays XP, since fleeing puts every enemy back.
    const amount = combat.figures
      .filter((f) => f.faction === 'enemy' && f.hp <= 0)
      .reduce((sum, f) => sum + (world.enemies.find((e) => e.id === f.defId)?.xp ?? 0), 0);
    if (amount > 0) {
      c.xp += amount;
      events.push({ type: 'xpGained', amount, xp: c.xp, levelsEarned: pendingLevelUps(c, world) });
    }
  }
  c.collection.push(...state.pendingLoot);
  state.pendingLoot = [];
  state.mode = outcome === 'lost' ? 'dead' : 'explore';
  state.combat = null;
  state.encounterId = null;
  return { state, events };
}
