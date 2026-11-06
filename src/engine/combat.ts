import { blinkTargets, distance, findPath, hasLineOfSight, livingFigures, pathTowardAttack, pushPath, reachableTiles, samePos, tileAt } from './grid';
import { shuffleInPlace } from './rng';
import { IllegalActionError } from './types';
import type {
  Action, ApplyResult, AttackEffect, BasicDef, BasicId, CardDef, CardInstance, CombatState, Condition, Effect,
  EnemyDef, Faction, Figure, GameEvent, Modifier, ModifierDeck, Pos, ResourceKind, RulesConfig, Tile,
} from './types';

export const PLAYER_ID = 'player';

export const DEFAULT_RULES: RulesConfig = {
  handSize: 5,
  postFightRecovery: 0.25,
  staminaRegenPerRound: 1,
  manaRegenPerRound: 1,
  trapDamage: 2,
  bleedDamage: 1,
};

export function standardModifiers(): Modifier[] {
  const add = (value: number, count: number): Modifier[] =>
    Array.from({ length: count }, () => ({ kind: 'add', value }));
  return [...add(0, 6), ...add(1, 5), ...add(-1, 5), ...add(2, 1), ...add(-2, 1), { kind: 'double' }, { kind: 'null' }];
}

export interface CombatSetup {
  seed: number;
  /** Rows of tiles. See `parseArena` for the legend. */
  arena: ArenaLayout;
  deck: CardDef[];
  enemyDefs: EnemyDef[];
  basics: Record<BasicId, BasicDef>;
  player: { hp: number; maxHp: number; stamina: number; maxStamina: number; mana: number; maxMana: number };
  rules?: Partial<RulesConfig>;
}

export interface ArenaLayout {
  width: number;
  height: number;
  tiles: Tile[];
  exits: Pos[];
  playerStart: Pos;
  enemies: { defId: string; pos: Pos }[];
}

/**
 * ASCII arena legend: `#` wall, `.` floor, `~` water, `^` trap, `E` exit,
 * `@` player start, and any key of `enemyKeys` for an enemy on floor.
 */
export function parseArena(rows: string[], enemyKeys: Record<string, string>): ArenaLayout {
  const width = rows[0]?.length ?? 0;
  const tiles: Tile[] = [];
  const exits: Pos[] = [];
  const enemies: ArenaLayout['enemies'] = [];
  let playerStart: Pos | null = null;
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`Arena row ${y} has width ${row.length}, expected ${width}`);
    [...row].forEach((ch, x) => {
      const enemyDefId = enemyKeys[ch];
      if (enemyDefId) enemies.push({ defId: enemyDefId, pos: { x, y } });
      if (ch === 'E') exits.push({ x, y });
      if (ch === '@') playerStart = { x, y };
      if (ch === '#') tiles.push('wall');
      else if (ch === '~') tiles.push('water');
      else if (ch === '^') tiles.push('trap');
      else if (ch === '.' || ch === 'E' || ch === '@' || enemyDefId) tiles.push('floor');
      else throw new Error(`Unknown arena character "${ch}" at ${x},${y}`);
    });
  });
  if (!playerStart) throw new Error('Arena has no player start');
  return { width, height: rows.length, tiles, exits, playerStart, enemies };
}

export function createCombat(setup: CombatSetup): ApplyResult {
  const rules = { ...DEFAULT_RULES, ...setup.rules };
  const defs = new Map(setup.enemyDefs.map((d) => [d.id, d]));
  let rng = setup.seed | 0;

  const cards: Record<string, CardInstance> = {};
  setup.deck.forEach((def, i) => {
    const instanceId = `c${i}`;
    cards[instanceId] = { ...def, instanceId };
  });
  const deck = Object.keys(cards);
  rng = shuffleInPlace(deck, rng);

  const figures: Figure[] = [{
    id: PLAYER_ID, name: 'You', faction: 'player', defId: PLAYER_ID, pos: { ...setup.arena.playerStart },
    hp: setup.player.hp, maxHp: setup.player.maxHp, shield: 0, conditions: [],
  }];
  const enemyDecks: CombatState['enemyDecks'] = {};
  const nameCounts = new Map<string, number>();
  setup.arena.enemies.forEach((placed, i) => {
    const def = defs.get(placed.defId);
    if (!def) throw new Error(`Unknown enemy "${placed.defId}"`);
    const number = (nameCounts.get(def.id) ?? 0) + 1;
    nameCounts.set(def.id, number);
    figures.push({
      id: `e${i}`, name: `${def.name} ${number}`, faction: 'enemy', defId: def.id, pos: { ...placed.pos },
      hp: def.hp, maxHp: def.hp, shield: 0, conditions: [],
    });
    if (!enemyDecks[def.id]) {
      const draw = def.behaviors.map((b) => ({ ...b }));
      rng = shuffleInPlace(draw, rng);
      enemyDecks[def.id] = { draw, discard: [] };
    }
  });

  const playerMods = standardModifiers();
  rng = shuffleInPlace(playerMods, rng);
  const enemyMods = standardModifiers();
  rng = shuffleInPlace(enemyMods, rng);

  const state: CombatState = {
    rng, round: 0, width: setup.arena.width, height: setup.arena.height,
    tiles: [...setup.arena.tiles], exits: setup.arena.exits.map((p) => ({ ...p })), figures, cards,
    player: {
      stamina: setup.player.stamina, maxStamina: setup.player.maxStamina,
      mana: setup.player.mana, maxMana: setup.player.maxMana,
      hand: [], deck, discard: [],
    },
    committed: null, basics: setup.basics, enemyDecks, revealed: {}, turnOrder: [], turnIndex: 0,
    playerModifiers: { draw: playerMods, discard: [], reshufflePending: false },
    enemyModifiers: { draw: enemyMods, discard: [], reshufflePending: false },
    phase: { kind: 'planning' }, rules,
  };
  const events: GameEvent[] = [];
  startRound(state, events);
  return { state, events };
}

export const getPlayer = (state: CombatState): Figure => state.figures.find((f) => f.id === PLAYER_ID) as Figure;
export const livingEnemies = (state: CombatState): Figure[] => livingFigures(state).filter((f) => f.faction === 'enemy');
export const isOnExit = (state: CombatState): boolean => state.exits.some((p) => samePos(p, getPlayer(state).pos));

/** The effect the player must resolve now, if any. */
export function currentEffect(state: CombatState): Effect | null {
  return state.phase.kind === 'playerTurn' ? state.phase.effects[state.phase.index] ?? null : null;
}

export const canPlayCard = (state: CombatState, cardId: string): boolean => {
  const card = state.cards[cardId];
  return !!card && state.phase.kind === 'planning' && state.player.hand.includes(cardId) && card.cost <= state.player[card.costType];
};

export function legalMoveTargets(state: CombatState): Pos[] {
  const effect = currentEffect(state);
  const player = getPlayer(state);
  if (effect?.kind === 'blink') return blinkTargets(state, player.pos, effect.range);
  if (effect?.kind !== 'move' || player.conditions.includes('root')) return [];
  return reachableTiles(state, player.pos, effect.range);
}

export function legalAttackTargets(state: CombatState): Figure[] {
  const effect = currentEffect(state);
  if (effect?.kind !== 'attack') return [];
  return attackableBy(state, getPlayer(state), effect);
}

function attackableBy(state: CombatState, attacker: Figure, effect: AttackEffect): Figure[] {
  const range = effect.allAdjacent ? 1 : effect.range;
  return livingFigures(state).filter((f) =>
    f.faction !== attacker.faction && distance(f.pos, attacker.pos) <= range && hasLineOfSight(state, attacker.pos, f.pos));
}

export function applyAction(previous: CombatState, action: Action): ApplyResult {
  const state = JSON.parse(JSON.stringify(previous)) as CombatState;
  const events: GameEvent[] = [];
  const illegal = (why: string): never => { throw new IllegalActionError(`${action.type}: ${why}`); };

  if (state.phase.kind === 'ended') illegal('combat is over');

  switch (action.type) {
    case 'playCard': {
      if (state.phase.kind !== 'planning') illegal('not in planning');
      const card = state.cards[action.cardId];
      if (!card || !state.player.hand.includes(action.cardId)) return illegal('card is not in hand');
      if (card.cost > state.player[card.costType]) illegal(`not enough ${card.costType}`);
      changeResource(state, card.costType, -card.cost, 'cost', events);
      state.committed = { cardId: card.instanceId, name: card.name, initiative: card.initiative };
      events.push({ type: 'committed', name: card.name, initiative: card.initiative, cost: card.cost, costType: card.costType });
      beginResolution(state, events);
      break;
    }
    case 'useBasic': {
      if (state.phase.kind !== 'planning') illegal('not in planning');
      const { name, initiative } = state.basics[action.basic];
      state.committed = { basic: action.basic, name, initiative };
      events.push({ type: 'committed', name, initiative, cost: 0, costType: null });
      beginResolution(state, events);
      break;
    }
    case 'move': {
      const effect = currentEffect(state);
      const player = getPlayer(state);
      if (effect?.kind === 'blink') {
        if (!legalMoveTargets(state).some((p) => samePos(p, action.to))) illegal('tile is not in blink range');
        moveAlong(state, player, [action.to], 'blinked', events);
        advancePlayerEffects(state, events);
        break;
      }
      if (effect?.kind !== 'move') return illegal('no move to resolve');
      if (player.conditions.includes('root')) illegal('rooted');
      const path = findPath(state, player.pos, action.to, effect.range);
      if (!path || path.length === 0) return illegal('tile is not reachable');
      moveAlong(state, player, path, 'moved', events);
      advancePlayerEffects(state, events);
      break;
    }
    case 'attack': {
      const effect = currentEffect(state);
      if (effect?.kind !== 'attack') return illegal('no attack to resolve');
      const player = getPlayer(state);
      const legal = attackableBy(state, player, effect);
      if (!legal.some((f) => f.id === action.targetId)) illegal('target is not attackable');
      const primary = legal.find((f) => f.id === action.targetId) as Figure;
      const targets = effect.allAdjacent ? legal : [primary, ...blastVictims(state, primary, effect)];
      for (const target of targets) resolveAttack(state, player, target, effect, events);
      advancePlayerEffects(state, events);
      break;
    }
    case 'skipEffect': {
      if (state.phase.kind !== 'playerTurn') illegal('nothing to skip');
      const effect = currentEffect(state);
      if (effect) events.push({ type: 'effectSkipped', kind: effect.kind, chosen: true });
      advancePlayerEffects(state, events);
      break;
    }
    case 'flee': {
      if (state.phase.kind !== 'playerTurn') illegal('not your turn');
      if (!isOnExit(state)) illegal('not on an exit');
      endCombat(state, 'fled', events);
      break;
    }
  }
  return { state, events };
}

/** Other enemies caught around the primary target. Walls shelter them. */
function blastVictims(state: CombatState, primary: Figure, effect: AttackEffect): Figure[] {
  const radius = effect.blast ?? 0;
  return livingFigures(state).filter((f) => f.id !== primary.id && f.faction === primary.faction
    && distance(f.pos, primary.pos) <= radius && hasLineOfSight(state, primary.pos, f.pos));
}

function startRound(state: CombatState, events: GameEvent[]): void {
  state.round += 1;
  if (state.round > 1) {
    changeResource(state, 'stamina', state.rules.staminaRegenPerRound, 'regen', events);
    changeResource(state, 'mana', state.rules.manaRegenPerRound, 'regen', events);
  }
  state.committed = null;
  state.revealed = {};
  state.turnOrder = [];
  state.turnIndex = 0;
  for (const f of state.figures) f.shield = 0;
  drawToHandSize(state);
  state.phase = { kind: 'planning' };
  events.push({ type: 'roundStarted', round: state.round });
}

function drawToHandSize(state: CombatState): void {
  const p = state.player;
  while (p.hand.length < state.rules.handSize) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) return;
      p.deck = p.discard;
      p.discard = [];
      state.rng = shuffleInPlace(p.deck, state.rng);
    }
    p.hand.push(p.deck.pop() as string);
  }
}

/** Reveals enemy behaviors, fixes the turn order and runs turns up to the player's. */
function beginResolution(state: CombatState, events: GameEvent[]): void {
  const defIds = [...new Set(livingEnemies(state).map((e) => e.defId))];
  for (const defId of defIds) {
    const deck = state.enemyDecks[defId];
    if (!deck) continue;
    if (deck.draw.length === 0) {
      deck.draw = deck.discard;
      deck.discard = [];
      state.rng = shuffleInPlace(deck.draw, state.rng);
    }
    const behavior = deck.draw.pop();
    if (!behavior) continue;
    deck.discard.push(behavior);
    state.revealed[defId] = behavior;
    const enemyName = (state.figures.find((f) => f.defId === defId)?.name ?? defId).replace(/ \d+$/, '');
    events.push({ type: 'revealed', enemyDefId: defId, enemyName, behavior: behavior.name, initiative: behavior.initiative });
  }
  // Lowest initiative first; ties favor the player, then placement order.
  const entries = livingFigures(state).map((f, placement) => ({
    figureId: f.id,
    initiative: f.faction === 'player' ? (state.committed as { initiative: number }).initiative : state.revealed[f.defId]?.initiative ?? 99,
    placement,
  }));
  entries.sort((a, b) => a.initiative - b.initiative || a.placement - b.placement);
  state.turnOrder = entries.map(({ figureId, initiative }) => ({ figureId, initiative }));
  state.turnIndex = 0;
  runTurns(state, events);
}

/** Advances through the turn order until the player must act or the round ends. */
function runTurns(state: CombatState, events: GameEvent[]): void {
  while (state.turnIndex < state.turnOrder.length) {
    const entry = state.turnOrder[state.turnIndex] as { figureId: string };
    const figure = state.figures.find((f) => f.id === entry.figureId) as Figure;
    if (figure.hp <= 0) { state.turnIndex += 1; continue; }

    events.push({ type: 'turnStarted', figureId: figure.id, name: figure.name });
    if (figure.conditions.includes('bleed')) {
      applyDamage(figure, state.rules.bleedDamage, 'bleed', events, true);
      if (checkEnd(state, events)) return;
      if (figure.hp <= 0) { state.turnIndex += 1; continue; }
    }
    if (figure.conditions.includes('stun')) {
      events.push({ type: 'turnSkipped', figureId: figure.id, name: figure.name, reason: 'stun' });
      endFigureTurn(figure, events);
      state.turnIndex += 1;
      continue;
    }
    if (figure.faction === 'player') {
      if (beginPlayerTurn(state, events)) return;
    } else {
      runEnemyTurn(state, figure, events);
      if (checkEnd(state, events)) return;
    }
    if (figure.hp > 0) endFigureTurn(figure, events);
    state.turnIndex += 1;
  }
  finishRound(state, events);
}

/** Returns true if the player has to make a choice. */
function beginPlayerTurn(state: CombatState, events: GameEvent[]): boolean {
  const committed = state.committed;
  if (!committed) return false;
  const effects = committed.cardId
    ? (state.cards[committed.cardId] as CardInstance).effects
    : state.basics[committed.basic as BasicId].effects;
  state.phase = { kind: 'playerTurn', effects, index: 0 };
  return settlePlayerEffects(state, events);
}

/**
 * Resolves self-targeted effects and skips ones with no legal choice.
 * Returns true if it stopped on an effect that needs a player decision.
 */
function settlePlayerEffects(state: CombatState, events: GameEvent[]): boolean {
  const player = getPlayer(state);
  while (state.phase.kind === 'playerTurn') {
    const effect = state.phase.effects[state.phase.index];
    // With every effect spent, the turn only stays open if the player can flee.
    if (!effect) return isOnExit(state);
    switch (effect.kind) {
      case 'heal': applyHeal(player, effect.amount, events); break;
      case 'shield': player.shield += effect.amount; events.push({ type: 'shielded', figureId: player.id, amount: effect.amount }); break;
      case 'restore':
        changeResource(state, 'stamina', effect.stamina, 'restore', events);
        changeResource(state, 'mana', effect.mana, 'restore', events);
        break;
      case 'move':
      case 'blink':
        if (legalMoveTargets(state).length > 0) return true;
        events.push({ type: 'effectSkipped', kind: effect.kind, chosen: false });
        break;
      case 'attack':
        if (legalAttackTargets(state).length > 0) return true;
        events.push({ type: 'effectSkipped', kind: 'attack', chosen: false });
        break;
    }
    state.phase.index += 1;
  }
  return false;
}

function advancePlayerEffects(state: CombatState, events: GameEvent[]): void {
  if (checkEnd(state, events)) return;
  if (state.phase.kind !== 'playerTurn') return;
  // Past the last effect, this action is the player declining to flee.
  if (state.phase.index < state.phase.effects.length) {
    state.phase.index += 1;
    if (settlePlayerEffects(state, events)) return;
    if (checkEnd(state, events)) return;
  }
  endFigureTurn(getPlayer(state), events);
  state.turnIndex += 1;
  runTurns(state, events);
}

function endFigureTurn(figure: Figure, events: GameEvent[]): void {
  for (const condition of ['stun', 'root', 'weak'] as const) {
    if (!figure.conditions.includes(condition)) continue;
    figure.conditions = figure.conditions.filter((c) => c !== condition);
    events.push({ type: 'conditionEnded', figureId: figure.id, condition });
  }
}

function finishRound(state: CombatState, events: GameEvent[]): void {
  const cardId = state.committed?.cardId;
  if (cardId) {
    state.player.hand = state.player.hand.filter((id) => id !== cardId);
    state.player.discard.push(cardId);
  }
  startRound(state, events);
}

function runEnemyTurn(state: CombatState, enemy: Figure, events: GameEvent[]): void {
  const behavior = state.revealed[enemy.defId];
  if (!behavior) return;
  const player = getPlayer(state);
  behavior.effects.forEach((effect, i) => {
    if (enemy.hp <= 0 || player.hp <= 0) return;
    switch (effect.kind) {
      case 'move': {
        if (enemy.conditions.includes('root')) return;
        const next = behavior.effects.slice(i + 1).find((e): e is AttackEffect => e.kind === 'attack');
        const path = pathTowardAttack(state, enemy.pos, player.pos, next?.range ?? 1, effect.range);
        if (path.length > 0) moveAlong(state, enemy, path, 'moved', events);
        break;
      }
      case 'attack':
        if (attackableBy(state, enemy, effect).some((f) => f.id === player.id)) {
          resolveAttack(state, enemy, player, effect, events);
        }
        break;
      case 'heal': applyHeal(enemy, effect.amount, events); break;
      case 'shield': enemy.shield += effect.amount; events.push({ type: 'shielded', figureId: enemy.id, amount: effect.amount }); break;
      default: break;
    }
  });
}

function moveAlong(state: CombatState, figure: Figure, path: Pos[], type: 'moved' | 'pushed' | 'blinked', events: GameEvent[]): void {
  events.push({ type, figureId: figure.id, path: path.map((p) => ({ ...p })) });
  for (const step of path) {
    figure.pos = { ...step };
    if (tileAt(state, step) === 'trap') {
      state.tiles[step.y * state.width + step.x] = 'floor';
      events.push({ type: 'trapSprung', pos: { ...step }, figureId: figure.id });
      applyDamage(figure, state.rules.trapDamage, 'trap', events, true);
      if (figure.hp <= 0) return;
    }
  }
}

function deckFor(state: CombatState, faction: Faction): ModifierDeck {
  return faction === 'player' ? state.playerModifiers : state.enemyModifiers;
}

function drawModifier(state: CombatState, faction: Faction): Modifier {
  const deck = deckFor(state, faction);
  if (deck.draw.length === 0) reshuffle(state, faction);
  const modifier = deck.draw.pop() as Modifier;
  deck.discard.push(modifier);
  if (modifier.kind !== 'add') deck.reshufflePending = true;
  return modifier;
}

function reshuffle(state: CombatState, faction: Faction): void {
  const deck = deckFor(state, faction);
  deck.draw = [...deck.draw, ...deck.discard];
  deck.discard = [];
  deck.reshufflePending = false;
  state.rng = shuffleInPlace(deck.draw, state.rng);
}

function resolveAttack(state: CombatState, attacker: Figure, target: Figure, effect: AttackEffect, events: GameEvent[]): void {
  const base = Math.max(0, effect.damage - (attacker.conditions.includes('weak') ? 1 : 0));
  const modifier = drawModifier(state, attacker.faction);
  const total = modifier.kind === 'null' ? 0 : modifier.kind === 'double' ? base * 2 : Math.max(0, base + modifier.value);
  events.push({ type: 'attacked', attackerId: attacker.id, targetId: target.id, base, modifier, total });

  applyDamage(target, total, 'attack', events, false);
  if (modifier.kind !== 'null' && target.hp > 0) {
    for (const condition of effect.conditions ?? []) addCondition(target, condition, events);
    if (effect.push) {
      const path = pushPath(state, target, attacker.pos, effect.push);
      if (path.length > 0) moveAlong(state, target, path, 'pushed', events);
    }
  }
  const deck = deckFor(state, attacker.faction);
  if (deck.reshufflePending) {
    reshuffle(state, attacker.faction);
    events.push({ type: 'modifierDeckShuffled', owner: attacker.faction });
  }
}

function addCondition(target: Figure, condition: Condition, events: GameEvent[]): void {
  if (target.conditions.includes(condition)) return;
  target.conditions.push(condition);
  events.push({ type: 'conditionApplied', figureId: target.id, condition });
}

function applyDamage(
  target: Figure, amount: number, source: 'attack' | 'bleed' | 'trap', events: GameEvent[], ignoreShield: boolean,
): void {
  const blocked = ignoreShield ? 0 : Math.min(target.shield, amount);
  const dealt = amount - blocked;
  target.hp = Math.max(0, target.hp - dealt);
  events.push({ type: 'damaged', figureId: target.id, amount: dealt, blocked, hp: target.hp, source });
  if (target.hp === 0) events.push({ type: 'defeated', figureId: target.id, name: target.name });
}

function applyHeal(figure: Figure, amount: number, events: GameEvent[]): void {
  const healed = Math.min(amount, figure.maxHp - figure.hp);
  figure.hp += healed;
  events.push({ type: 'healed', figureId: figure.id, amount: healed, hp: figure.hp });
  if (figure.conditions.includes('bleed')) {
    figure.conditions = figure.conditions.filter((c) => c !== 'bleed');
    events.push({ type: 'conditionEnded', figureId: figure.id, condition: 'bleed' });
  }
}

function changeResource(
  state: CombatState, resource: ResourceKind, delta: number,
  source: 'cost' | 'regen' | 'restore' | 'recovery', events: GameEvent[],
): void {
  const p = state.player;
  const before = p[resource];
  const max = resource === 'stamina' ? p.maxStamina : p.maxMana;
  p[resource] = Math.min(max, Math.max(0, before + delta));
  const applied = p[resource] - before;
  if (applied !== 0) events.push({ type: 'resourceChanged', resource, delta: applied, value: p[resource], source });
}

function checkEnd(state: CombatState, events: GameEvent[]): boolean {
  if (getPlayer(state).hp <= 0) { endCombat(state, 'lost', events); return true; }
  if (livingEnemies(state).length === 0) { endCombat(state, 'won', events); return true; }
  return false;
}

function endCombat(state: CombatState, outcome: 'won' | 'lost' | 'fled', events: GameEvent[]): void {
  if (outcome === 'won') {
    changeResource(state, 'stamina', Math.ceil(state.player.maxStamina * state.rules.postFightRecovery), 'recovery', events);
  }
  state.phase = { kind: 'ended', outcome };
  events.push({ type: 'combatEnded', outcome });
}
