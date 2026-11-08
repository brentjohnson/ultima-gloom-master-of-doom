import type { BasicDef, BasicId, Effect } from './types';

export type Pool = 'hp' | 'stamina' | 'mana';

/** A numeric field of one of a basic action's effects, such as Move's range. */
export type UpgradeStat = 'range' | 'damage' | 'blast' | 'push' | 'amount' | 'stamina' | 'mana';

/** One level's improvement to a basic action: +1 to a stat, or 10 faster. */
export type BasicUpgrade =
  | { basic: BasicId; kind: 'initiative' }
  | { basic: BasicId; kind: 'stat'; effectIndex: number; stat: UpgradeStat };

export interface LevelRules {
  /** Total XP needed to reach level 2, 3 and so on. The last entry is the level cap. */
  thresholds: number[];
  /** How much each pool's maximum grows when chosen. */
  poolGrowth: Record<Pool, number>;
  /** How much faster an initiative upgrade makes a basic action. */
  initiativeStep: number;
}

export const BASIC_IDS: BasicId[] = ['move', 'attack', 'spark', 'catchBreath'];

const STATS: UpgradeStat[] = ['range', 'damage', 'blast', 'push', 'amount', 'stamina', 'mana'];

function statsOf(effect: Effect): UpgradeStat[] {
  const fields = effect as unknown as Record<string, unknown>;
  return STATS.filter((stat) => typeof fields[stat] === 'number');
}

/** The level a character has earned with this much XP, whether or not they've taken it yet. */
export function levelForXp(xp: number, rules: LevelRules): number {
  return 1 + rules.thresholds.filter((needed) => xp >= needed).length;
}

/** XP needed for the next level, or null at the cap. */
export function nextThreshold(level: number, rules: LevelRules): number | null {
  return rules.thresholds[level - 1] ?? null;
}

/** Every upgrade available for the basic actions as they are now. */
export function basicUpgradeOptions(basics: Record<BasicId, BasicDef>, rules: LevelRules): BasicUpgrade[] {
  const options: BasicUpgrade[] = [];
  for (const basic of BASIC_IDS) {
    const def = basics[basic];
    def.effects.forEach((effect, effectIndex) => {
      for (const stat of statsOf(effect)) options.push({ basic, kind: 'stat', effectIndex, stat });
    });
    if (def.initiative - rules.initiativeStep >= 1) options.push({ basic, kind: 'initiative' });
  }
  return options;
}

export const sameUpgrade = (a: BasicUpgrade, b: BasicUpgrade): boolean =>
  a.basic === b.basic && a.kind === b.kind
  && (a.kind === 'initiative' || (b.kind === 'stat' && a.effectIndex === b.effectIndex && a.stat === b.stat));

/** The basic actions with every upgrade taken so far. Cards are never affected. */
export function upgradedBasics(
  basics: Record<BasicId, BasicDef>, upgrades: BasicUpgrade[], rules: LevelRules,
): Record<BasicId, BasicDef> {
  const result = JSON.parse(JSON.stringify(basics)) as Record<BasicId, BasicDef>;
  for (const upgrade of upgrades) {
    const def = result[upgrade.basic];
    if (upgrade.kind === 'initiative') {
      def.initiative = Math.max(1, def.initiative - rules.initiativeStep);
      continue;
    }
    const fields = def.effects[upgrade.effectIndex] as unknown as Record<string, number> | undefined;
    if (!fields || typeof fields[upgrade.stat] !== 'number') throw new Error(`${upgrade.basic} has no ${upgrade.stat} to upgrade`);
    fields[upgrade.stat] = (fields[upgrade.stat] as number) + 1;
  }
  return result;
}
