import type { Effect, GameEvent, Modifier } from '../engine';

export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case 'move': return `Move ${effect.range}`;
    case 'heal': return `Heal ${effect.amount}, cure bleed`;
    case 'shield': return `Shield ${effect.amount} this round`;
    case 'attack': {
      const parts = [`Attack ${effect.damage}`];
      if (effect.allAdjacent) parts.push('all adjacent');
      else if (effect.range > 1) parts.push(`range ${effect.range}`);
      if (effect.push) parts.push(`push ${effect.push}`);
      for (const c of effect.conditions ?? []) parts.push(c);
      return parts.join(', ');
    }
  }
}

function modifierText(modifier: Modifier): string {
  if (modifier.kind === 'null') return 'null (miss)';
  if (modifier.kind === 'double') return 'x2';
  return modifier.value >= 0 ? `+${modifier.value}` : `${modifier.value}`;
}

/** One log line per event, or null for events that would only add noise. */
export function logLine(event: GameEvent, nameOf: (id: string) => string): string | null {
  switch (event.type) {
    case 'roundStarted': return `-- Round ${event.round} --`;
    case 'committed': return `You commit ${event.name} (initiative ${event.initiative}).`;
    case 'revealed': return `${event.enemyName}: ${event.behavior} (initiative ${event.initiative}).`;
    case 'turnSkipped': return `${event.name} is stunned and loses the turn.`;
    case 'attacked': return `${nameOf(event.attackerId)} attacks ${nameOf(event.targetId)}: ${event.base}, modifier ${modifierText(event.modifier)}, total ${event.total}.`;
    case 'damaged':
      if (event.source === 'attack') return event.blocked > 0 ? `${nameOf(event.figureId)} blocks ${event.blocked} and takes ${event.amount}.` : null;
      return `${nameOf(event.figureId)} takes ${event.amount} from ${event.source}.`;
    case 'trapSprung': return `${nameOf(event.figureId)} springs a trap!`;
    case 'conditionApplied': return `${nameOf(event.figureId)} gains ${event.condition}.`;
    case 'healed': return `${nameOf(event.figureId)} heals ${event.amount}.`;
    case 'shielded': return `${nameOf(event.figureId)} gains shield ${event.amount}.`;
    case 'defeated': return `${event.name} is defeated.`;
    case 'modifierDeckShuffled': return `${event.owner === 'player' ? 'Your' : 'The enemy'} modifier deck is reshuffled.`;
    case 'effectSkipped': return `No legal ${event.kind}, so it is skipped.`;
    case 'combatEnded': return event.outcome === 'won' ? 'Victory!' : event.outcome === 'fled' ? 'You escape.' : 'You have fallen.';
    default: return null;
  }
}
