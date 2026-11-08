import type { BasicDef, BasicId, BasicUpgrade, Effect, GameEvent, Modifier, Pool } from '../engine';

export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case 'move': return `Move ${effect.range}`;
    case 'blink': return `Blink ${effect.range} in sight`;
    case 'restore': return `+${effect.stamina} stamina, +${effect.mana} mana`;
    case 'heal': return `Heal ${effect.amount}, cure bleed`;
    case 'shield': return `Shield ${effect.amount} this round`;
    case 'attack': {
      const parts = [`Attack ${effect.damage}`];
      if (effect.allAdjacent) parts.push('all adjacent');
      else if (effect.range > 1) parts.push(`range ${effect.range}`);
      if (effect.blast) parts.push(`blast ${effect.blast}`);
      if (effect.push) parts.push(`push ${effect.push}`);
      for (const c of effect.conditions ?? []) parts.push(c);
      if (effect.keepBetterModifier) parts.push('draw 2 modifiers, keep the better');
      return parts.join(', ');
    }
  }
}

export const POOL_NAMES: Record<Pool, string> = { hp: 'Health', stamina: 'Stamina', mana: 'Mana' };

/** For example "Spark: range 3 to 4", using the actions as they are before the upgrade. */
export function describeUpgrade(upgrade: BasicUpgrade, basics: Record<BasicId, BasicDef>, initiativeStep: number): string {
  const def = basics[upgrade.basic];
  if (upgrade.kind === 'initiative') {
    return `${def.name}: initiative ${def.initiative} to ${Math.max(1, def.initiative - initiativeStep)}`;
  }
  const value = (def.effects[upgrade.effectIndex] as unknown as Record<string, number> | undefined)?.[upgrade.stat] ?? 0;
  return `${def.name}: ${upgrade.stat} ${value} to ${value + 1}`;
}

function modifierText(modifier: Modifier): string {
  if (modifier.kind === 'null') return 'null (miss)';
  if (modifier.kind === 'double') return 'x2';
  return modifier.value >= 0 ? `+${modifier.value}` : `${modifier.value}`;
}

const YOU = 'You';
const subject = (name: string, base: string, third: string) => `${name} ${name === YOU ? base : third}`;

/** One log line per event, or null for events that would only add noise. */
export function logLine(event: GameEvent, nameOf: (id: string) => string): string | null {
  switch (event.type) {
    case 'roundStarted': return `-- Round ${event.round} --`;
    case 'committed': return `You commit ${event.name} (initiative ${event.initiative}).`;
    case 'revealed': return `${event.enemyName}: ${event.behavior} (initiative ${event.initiative}).`;
    case 'turnSkipped': return event.name === YOU ? 'You are stunned and lose the turn.' : `${event.name} is stunned and loses the turn.`;
    case 'attacked': return `${subject(nameOf(event.attackerId), 'attack', 'attacks')} ${nameOf(event.targetId)}: ${event.base}, modifier ${modifierText(event.modifier)}${event.discarded ? ` (over ${modifierText(event.discarded)})` : ''}, total ${event.total}.`;
    case 'damaged':
      if (event.source === 'attack') return event.blocked > 0 ? `${subject(nameOf(event.figureId), 'block', 'blocks')} ${event.blocked} and take${nameOf(event.figureId) === YOU ? '' : 's'} ${event.amount}.` : null;
      return `${subject(nameOf(event.figureId), 'take', 'takes')} ${event.amount} from ${event.source}.`;
    case 'trapSprung': return `${subject(nameOf(event.figureId), 'spring', 'springs')} a trap!`;
    case 'conditionApplied': return `${subject(nameOf(event.figureId), 'gain', 'gains')} ${event.condition}.`;
    case 'healed': return `${subject(nameOf(event.figureId), 'heal', 'heals')} ${event.amount}.`;
    case 'shielded': return `${subject(nameOf(event.figureId), 'gain', 'gains')} shield ${event.amount}.`;
    case 'defeated': return event.name === YOU ? 'You are defeated.' : `${event.name} is defeated.`;
    case 'resourceChanged':
      if (event.source === 'restore') return `You recover ${event.delta} ${event.resource}.`;
      if (event.source === 'recovery') return `You catch your breath after the fight: +${event.delta} ${event.resource}.`;
      return null;
    case 'modifierDeckShuffled': return `${event.owner === 'player' ? 'Your' : 'The enemy'} modifier deck is reshuffled.`;
    case 'effectSkipped':
      if (event.chosen) return event.kind === 'move' || event.kind === 'blink' ? 'You stay put.' : `You skip the ${event.kind}.`;
      return `No legal ${event.kind}, so it is skipped.`;
    case 'combatEnded': return event.outcome === 'won' ? 'Victory!' : event.outcome === 'fled' ? 'You escape.' : 'You have fallen.';
    default: return null;
  }
}
