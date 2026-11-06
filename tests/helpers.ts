import { applyAction, createCombat, legalAttackTargets, legalMoveTargets, currentEffect, parseArena } from '../src/engine';
import type { Action, AttackEffect, CardDef, CombatState, EnemyDef, GameEvent, Modifier } from '../src/engine';

export const dummy: EnemyDef = {
  id: 'dummy', name: 'Dummy', hp: 10,
  behaviors: [{ name: 'Idle', initiative: 50, effects: [{ kind: 'shield', amount: 1 }] }],
};
export const biter: EnemyDef = {
  id: 'biter', name: 'Biter', hp: 10,
  behaviors: [{ name: 'Bite', initiative: 10, effects: [{ kind: 'move', range: 3 }, { kind: 'attack', damage: 2, range: 1 }] }],
};

export const card = (id: string, initiative: number, staminaCost: number, effects: CardDef['effects']): CardDef =>
  ({ id, name: id, initiative, staminaCost, effects });

export function setup(rows: string[], deck: CardDef[], enemyDefs: EnemyDef[] = [dummy, biter], seed = 1, stamina = 20) {
  return createCombat({
    seed, deck, enemyDefs,
    arena: parseArena(rows, { d: 'dummy', b: 'biter' }),
    player: { hp: 20, maxHp: 20, stamina, maxStamina: 20 },
  });
}

/** Rigs the next modifier the given side draws, for exact damage assertions. */
export function rigModifier(state: CombatState, side: 'player' | 'enemy', modifier: Modifier): CombatState {
  const next = JSON.parse(JSON.stringify(state)) as CombatState;
  (side === 'player' ? next.playerModifiers : next.enemyModifiers).draw.push(modifier);
  return next;
}

export const cardIdNamed = (state: CombatState, id: string): string => {
  const found = Object.values(state.cards).find((c) => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found.instanceId;
};

export function step(state: CombatState, action: Action): { state: CombatState; events: GameEvent[] } {
  return applyAction(state, action);
}

/** Greedy player used for determinism, invariant and balance runs. */
export function botAction(state: CombatState): Action {
  const player = state.figures.find((f) => f.id === 'player');
  if (!player) throw new Error('no player');
  const enemies = state.figures.filter((f) => f.faction === 'enemy' && f.hp > 0);
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  if (state.phase.kind === 'planning') {
    const playable = state.player.hand
      .map((id) => state.cards[id])
      .filter((c): c is NonNullable<typeof c> => !!c && c.staminaCost <= state.player.stamina);
    const nearest = Math.min(...enemies.map((e) => dist(e.pos, player.pos)));
    const score = (c: CombatState['cards'][string]): number => {
      let total = 0;
      let reach = 0;
      for (const effect of c.effects) {
        if (effect.kind === 'move') reach += effect.range;
        if (effect.kind === 'attack') {
          total += (nearest <= effect.range + reach ? effect.damage + 2 : 0) + (effect.conditions?.length ?? 0);
        }
        if (effect.kind === 'heal') total += player.hp <= 10 ? effect.amount : 0;
        if (effect.kind === 'shield') total += 1;
        if (effect.kind === 'move' && nearest > 1) total += 1;
      }
      return total - c.staminaCost * 0.4;
    };
    const best = playable.sort((a, b) => score(b) - score(a))[0];
    if (best && score(best) > 0) return { type: 'playCard', cardId: best.instanceId };
    if (nearest <= 1) return { type: 'useBasic', basic: 'struggleAttack' };
    return state.player.stamina < 6 ? { type: 'useBasic', basic: 'catchBreath' } : { type: 'useBasic', basic: 'struggleMove' };
  }

  const effect = currentEffect(state);
  if (effect?.kind === 'attack') {
    const targets = legalAttackTargets(state).sort((a, b) => a.hp - b.hp);
    const target = targets[0] as { id: string };
    return { type: 'attack', targetId: target.id };
  }
  if (effect?.kind === 'move') {
    const next = effect && state.phase.kind === 'playerTurn' ? state.phase.effects[state.phase.index + 1] : undefined;
    const wanted = next?.kind === 'attack' ? (next as AttackEffect).range : 1;
    const tiles = legalMoveTargets(state);
    const quality = (t: { x: number; y: number }) => {
      const d = Math.min(...enemies.map((e) => dist(e.pos, t)));
      return Math.abs(d - wanted);
    };
    const best = [...tiles].sort((a, b) => quality(a) - quality(b))[0];
    return best ? { type: 'move', to: best } : { type: 'skipEffect' };
  }
  return { type: 'skipEffect' };
}

export function playOut(start: CombatState, maxActions = 2000): { state: CombatState; actions: Action[]; events: GameEvent[] } {
  let state = start;
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  while (state.phase.kind !== 'ended') {
    if (actions.length >= maxActions) throw new Error('fight did not terminate');
    const action = botAction(state);
    actions.push(action);
    const result = applyAction(state, action);
    state = result.state;
    events.push(...result.events);
  }
  return { state, actions, events };
}
