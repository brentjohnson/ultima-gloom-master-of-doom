import { nextRandom } from './rng';
import type { AttackEffect, CardDef, Condition, Effect } from './types';

export type DropRarity = 'common' | 'rare' | 'fabled';
/** Starting cards are plain: they have no rolled properties. */
export type Rarity = 'plain' | DropRarity;

export const RARITY_ORDER: Rarity[] = ['plain', 'common', 'rare', 'fabled'];

/** One physical copy of a card. Its properties were rolled once, when it dropped. */
export interface OwnedCard {
  uid: string;
  defId: string;
  rarity: Rarity;
  /** Affix ids, in the order they were rolled. */
  affixes: string[];
}

export type BoostStat = 'damage' | 'attackRange' | 'blast' | 'push' | 'move' | 'blink' | 'heal' | 'shield';

export type AffixMod =
  | { kind: 'cost'; delta: number }
  | { kind: 'initiative'; delta: number }
  | { kind: 'boost'; stat: BoostStat; delta: number }
  | { kind: 'condition'; condition: Condition }
  | { kind: 'keepBetterModifier' }
  | { kind: 'addEffect'; effect: Effect };

/** Affixes change a card's fixed numbers and abilities, and never add a chance of anything. */
export interface AffixDef {
  id: string;
  name: string;
  /** A card can hold only one affix from each group. */
  group: string;
  minRarity: DropRarity;
  mods: AffixMod[];
}

export interface LootTable {
  /** Cards dropped by each won encounter. */
  drops: number;
  rarities: Record<DropRarity, number>;
  cards: { id: string; weight: number }[];
}

export interface LootData {
  affixCounts: Record<DropRarity, number>;
  /** By zone. Player level is never an input, so better drops come from more dangerous places. */
  tables: Record<string, LootTable>;
}

const attacksOf = (card: CardDef): AttackEffect[] =>
  card.effects.filter((e): e is AttackEffect => e.kind === 'attack');

function boostTargets(card: CardDef, stat: BoostStat): Effect[] {
  switch (stat) {
    case 'damage': return attacksOf(card);
    case 'attackRange': return attacksOf(card).filter((e) => e.range > 1 && !e.allAdjacent);
    case 'blast': return attacksOf(card).filter((e) => e.blast);
    case 'push': return attacksOf(card).filter((e) => !e.allAdjacent);
    case 'move':
    case 'blink':
    case 'heal':
    case 'shield':
      return card.effects.filter((e) => e.kind === stat);
  }
}

function boost(effect: Effect, stat: BoostStat, delta: number): void {
  if (effect.kind === 'attack') {
    if (stat === 'damage') effect.damage += delta;
    else if (stat === 'attackRange') effect.range += delta;
    else if (stat === 'blast') effect.blast = (effect.blast ?? 0) + delta;
    else if (stat === 'push') effect.push = (effect.push ?? 0) + delta;
  } else if (effect.kind === 'move' || effect.kind === 'blink') {
    effect.range += delta;
  } else if (effect.kind === 'heal' || effect.kind === 'shield') {
    effect.amount += delta;
  }
}

function modApplies(card: CardDef, mod: AffixMod): boolean {
  switch (mod.kind) {
    case 'cost': return card.cost + mod.delta >= 0;
    case 'initiative': return mod.delta < 0 ? card.initiative > 1 : card.initiative < 99;
    case 'boost': return boostTargets(card, mod.stat).length > 0;
    case 'condition': return attacksOf(card).some((e) => !e.conditions?.includes(mod.condition));
    case 'keepBetterModifier': return attacksOf(card).some((e) => !e.keepBetterModifier);
    case 'addEffect': return !card.effects.some((e) => e.kind === mod.effect.kind);
  }
}

function applyMod(card: CardDef, mod: AffixMod): void {
  switch (mod.kind) {
    case 'cost':
      card.cost += mod.delta;
      break;
    case 'initiative':
      card.initiative = Math.max(1, Math.min(99, card.initiative + mod.delta));
      break;
    case 'boost':
      for (const effect of boostTargets(card, mod.stat)) boost(effect, mod.stat, mod.delta);
      break;
    case 'condition':
      for (const effect of attacksOf(card)) {
        if (!effect.conditions?.includes(mod.condition)) effect.conditions = [...(effect.conditions ?? []), mod.condition];
      }
      break;
    case 'keepBetterModifier':
      for (const effect of attacksOf(card)) effect.keepBetterModifier = true;
      break;
    case 'addEffect':
      card.effects.push(JSON.parse(JSON.stringify(mod.effect)) as Effect);
      break;
  }
}

const copyCard = (card: CardDef): CardDef => JSON.parse(JSON.stringify(card)) as CardDef;

/** What an owned card actually does: its definition with its affixes applied. */
export function resolveCard(owned: OwnedCard, cards: Map<string, CardDef>, affixes: Map<string, AffixDef>): CardDef {
  const def = cards.get(owned.defId);
  if (!def) throw new Error(`Unknown card "${owned.defId}"`);
  const card = copyCard(def);
  card.rarity = owned.rarity;
  card.affixNames = [];
  for (const id of owned.affixes) {
    const affix = affixes.get(id);
    if (!affix) throw new Error(`Unknown affix "${id}"`);
    for (const mod of affix.mods) applyMod(card, mod);
    card.affixNames.push(affix.name);
  }
  return card;
}

/** Affixes a card of this rarity could still gain, given what it already has. */
export function eligibleAffixes(card: CardDef, rarity: DropRarity, chosen: AffixDef[], affixes: Map<string, AffixDef>): AffixDef[] {
  const rank = RARITY_ORDER.indexOf(rarity);
  return [...affixes.values()].filter((affix) =>
    RARITY_ORDER.indexOf(affix.minRarity) <= rank
    && !chosen.some((c) => c.group === affix.group)
    && affix.mods.every((mod) => modApplies(card, mod)));
}

function pickWeighted<T>(items: T[], weightOf: (item: T) => number, rng: number): { item: T; rng: number } {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  const random = nextRandom(rng);
  let roll = random.value * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return { item, rng: random.rng };
  }
  return { item: items[items.length - 1] as T, rng: random.rng };
}

const DROP_RARITIES: DropRarity[] = ['common', 'rare', 'fabled'];

/** Rolls one drop. Everything about the card is decided here and never changes afterwards. */
export function rollDrop(
  table: LootTable, loot: LootData, cards: Map<string, CardDef>, affixes: Map<string, AffixDef>, uid: string, startRng: number,
): { card: OwnedCard; rng: number } {
  const rarity = pickWeighted(DROP_RARITIES, (r) => table.rarities[r], startRng);
  const picked = pickWeighted(table.cards, (c) => c.weight, rarity.rng);
  let { rng } = picked;

  const def = cards.get(picked.item.id);
  if (!def) throw new Error(`Unknown card "${picked.item.id}"`);
  const working = copyCard(def);
  const chosen: AffixDef[] = [];
  for (let i = 0; i < loot.affixCounts[rarity.item]; i++) {
    const options = eligibleAffixes(working, rarity.item, chosen, affixes);
    if (options.length === 0) break;
    const pick = pickWeighted(options, () => 1, rng);
    rng = pick.rng;
    chosen.push(pick.item);
    for (const mod of pick.item.mods) applyMod(working, mod);
  }
  return { card: { uid, defId: def.id, rarity: rarity.item, affixes: chosen.map((a) => a.id) }, rng };
}
