export interface Pos { x: number; y: number }

export type Tile = 'floor' | 'wall' | 'water' | 'trap';
export type Condition = 'bleed' | 'stun' | 'root' | 'weak';
export type Faction = 'player' | 'enemy';

export interface MoveEffect { kind: 'move'; range: number }
export interface AttackEffect {
  kind: 'attack';
  damage: number;
  range: number;
  /** Hits every enemy next to the attacker instead of one target. */
  allAdjacent?: boolean;
  /** Also hits enemies within this distance of the target, if the target can see them. */
  blast?: number;
  push?: number;
  conditions?: Condition[];
}
export interface HealEffect { kind: 'heal'; amount: number }
export interface ShieldEffect { kind: 'shield'; amount: number }
/** Teleports to a tile in sight, crossing water and figures. Works while rooted. */
export interface BlinkEffect { kind: 'blink'; range: number }
export interface RestoreEffect { kind: 'restore'; stamina: number; mana: number }
export type Effect = MoveEffect | AttackEffect | HealEffect | ShieldEffect | BlinkEffect | RestoreEffect;

export type ResourceKind = 'stamina' | 'mana';

export interface CardDef {
  id: string;
  name: string;
  initiative: number;
  cost: number;
  costType: ResourceKind;
  effects: Effect[];
}

export interface EnemyBehavior { name: string; initiative: number; effects: Effect[] }
export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  behaviors: EnemyBehavior[];
}

export type Modifier = { kind: 'add'; value: number } | { kind: 'double' } | { kind: 'null' };
export interface ModifierDeck { draw: Modifier[]; discard: Modifier[]; reshufflePending: boolean }

export interface Figure {
  id: string;
  name: string;
  faction: Faction;
  defId: string;
  pos: Pos;
  hp: number;
  maxHp: number;
  shield: number;
  conditions: Condition[];
}

export interface CardInstance extends CardDef { instanceId: string }

export interface PlayerResources {
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;
  hand: string[];
  deck: string[];
  discard: string[];
}

export type BasicId = 'move' | 'attack' | 'spark' | 'catchBreath';

/** A free, always-available action. Combat receives these already resolved from data. */
export interface BasicDef {
  name: string;
  initiative: number;
  effects: Effect[];
}

export type Outcome = 'won' | 'lost' | 'fled';

export type Phase =
  | { kind: 'planning' }
  /** The player is resolving `effects`, currently at `index`. */
  | { kind: 'playerTurn'; effects: Effect[]; index: number }
  | { kind: 'ended'; outcome: Outcome };

export interface TurnEntry { figureId: string; initiative: number }

export interface RulesConfig {
  handSize: number;
  /** Fraction of max stamina regained after a won fight. */
  postFightRecovery: number;
  staminaRegenPerRound: number;
  manaRegenPerRound: number;
  trapDamage: number;
  bleedDamage: number;
}

export interface CombatState {
  rng: number;
  round: number;
  width: number;
  height: number;
  /** Row-major tile grid; sprung traps become floor. */
  tiles: Tile[];
  /** Tiles the player may flee from. */
  exits: Pos[];
  figures: Figure[];
  cards: Record<string, CardInstance>;
  player: PlayerResources;
  /** Card or basic action committed this round. */
  committed: { cardId?: string; basic?: BasicId; name: string; initiative: number } | null;
  basics: Record<BasicId, BasicDef>;
  enemyDecks: Record<string, { draw: EnemyBehavior[]; discard: EnemyBehavior[] }>;
  /** Behaviors for this round, by enemy def. Empty until the player commits. */
  revealed: Record<string, EnemyBehavior>;
  turnOrder: TurnEntry[];
  turnIndex: number;
  playerModifiers: ModifierDeck;
  enemyModifiers: ModifierDeck;
  phase: Phase;
  rules: RulesConfig;
}

export type Action =
  | { type: 'playCard'; cardId: string }
  | { type: 'useBasic'; basic: BasicId }
  | { type: 'move'; to: Pos }
  | { type: 'attack'; targetId: string }
  | { type: 'skipEffect' }
  | { type: 'flee' };

export type GameEvent =
  | { type: 'roundStarted'; round: number }
  | { type: 'committed'; name: string; initiative: number; cost: number; costType: ResourceKind | null }
  | { type: 'revealed'; enemyDefId: string; enemyName: string; behavior: string; initiative: number }
  | { type: 'turnStarted'; figureId: string; name: string }
  | { type: 'turnSkipped'; figureId: string; name: string; reason: Condition }
  | { type: 'moved'; figureId: string; path: Pos[] }
  | { type: 'pushed'; figureId: string; path: Pos[] }
  | { type: 'blinked'; figureId: string; path: Pos[] }
  | { type: 'attacked'; attackerId: string; targetId: string; base: number; modifier: Modifier; total: number }
  | { type: 'damaged'; figureId: string; amount: number; blocked: number; hp: number; source: 'attack' | 'bleed' | 'trap' }
  | { type: 'trapSprung'; pos: Pos; figureId: string }
  | { type: 'conditionApplied'; figureId: string; condition: Condition }
  | { type: 'conditionEnded'; figureId: string; condition: Condition }
  | { type: 'healed'; figureId: string; amount: number; hp: number }
  | { type: 'shielded'; figureId: string; amount: number }
  | { type: 'defeated'; figureId: string; name: string }
  | { type: 'resourceChanged'; resource: ResourceKind; delta: number; value: number; source: 'cost' | 'regen' | 'restore' | 'recovery' }
  | { type: 'modifierDeckShuffled'; owner: Faction }
  | { type: 'effectSkipped'; kind: Effect['kind']; chosen: boolean }
  | { type: 'combatEnded'; outcome: Outcome };

export interface ApplyResult { state: CombatState; events: GameEvent[] }

export class IllegalActionError extends Error {}
