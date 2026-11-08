import { z } from 'zod';
import type { AffixDef, AffixMod, BasicDef, BasicId, CardDef, EnemyDef, Effect, LootData } from '../engine';

const condition = z.enum(['bleed', 'stun', 'root', 'weak']);

const effect: z.ZodType<Effect> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), range: z.number().int().positive() }),
  z.strictObject({
    kind: z.literal('attack'),
    damage: z.number().int().nonnegative(),
    range: z.number().int().positive(),
    allAdjacent: z.boolean().optional(),
    blast: z.number().int().positive().optional(),
    push: z.number().int().positive().optional(),
    conditions: z.array(condition).optional(),
    keepBetterModifier: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('heal'), amount: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('shield'), amount: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('blink'), range: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('restore'), stamina: z.number().int().nonnegative(), mana: z.number().int().nonnegative() }),
]);

const initiative = z.number().int().min(1).max(99);

export const cardSchema: z.ZodType<CardDef> = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  initiative,
  cost: z.number().int().nonnegative(),
  costType: z.enum(['stamina', 'mana']),
  effects: z.array(effect).min(1),
});

export const enemySchema: z.ZodType<EnemyDef> = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  hp: z.number().int().positive(),
  behaviors: z.array(z.strictObject({ name: z.string().min(1), initiative, effects: z.array(effect).min(1) })).min(1),
});

const basicSchema: z.ZodType<BasicDef> = z.strictObject({
  name: z.string().min(1),
  initiative,
  effects: z.array(effect).min(1),
});

const basicsSchema: z.ZodType<Record<BasicId, BasicDef>> = z.strictObject({
  move: basicSchema,
  attack: basicSchema,
  spark: basicSchema,
  catchBreath: basicSchema,
});

export const loadBasics = (raw: unknown): Record<BasicId, BasicDef> => basicsSchema.parse(raw);

function uniqueById<T extends { id: string }>(kind: string, items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`Duplicate ${kind} id "${item.id}"`);
    map.set(item.id, item);
  }
  return map;
}

export function loadCards(raw: unknown): Map<string, CardDef> {
  return uniqueById('card', z.array(cardSchema).parse(raw));
}

const dropRarity = z.enum(['common', 'rare', 'fabled']);
const delta = z.number().int();

const affixMod: z.ZodType<AffixMod> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('cost'), delta }),
  z.strictObject({ kind: z.literal('initiative'), delta }),
  z.strictObject({
    kind: z.literal('boost'),
    stat: z.enum(['damage', 'attackRange', 'blast', 'push', 'move', 'blink', 'heal', 'shield']),
    delta: z.number().int().positive(),
  }),
  z.strictObject({ kind: z.literal('condition'), condition }),
  z.strictObject({ kind: z.literal('keepBetterModifier') }),
  z.strictObject({ kind: z.literal('addEffect'), effect }),
]);

const affixSchema: z.ZodType<AffixDef> = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  group: z.string().min(1),
  minRarity: dropRarity,
  mods: z.array(affixMod).min(1),
});

export function loadAffixes(raw: unknown): Map<string, AffixDef> {
  return uniqueById('affix', z.array(affixSchema).parse(raw));
}

const weight = z.number().nonnegative();

const lootSchema: z.ZodType<LootData> = z.strictObject({
  affixCounts: z.strictObject({ common: z.number().int().positive(), rare: z.number().int().positive(), fabled: z.number().int().positive() }),
  tables: z.record(z.string(), z.strictObject({
    drops: z.number().int().positive(),
    rarities: z.strictObject({ common: weight, rare: weight, fabled: weight }),
    cards: z.array(z.strictObject({ id: z.string().min(1), weight: z.number().positive() })).min(1),
  })),
});

/** Throws with every problem listed, like a bad map does. */
export function loadLoot(raw: unknown, cards: Map<string, CardDef>): LootData {
  const loot = lootSchema.parse(raw);
  const errors: string[] = [];
  for (const [zone, table] of Object.entries(loot.tables)) {
    if (table.rarities.common + table.rarities.rare + table.rarities.fabled <= 0) errors.push(`${zone}: every rarity has zero weight`);
    for (const { id } of table.cards) if (!cards.has(id)) errors.push(`${zone}: unknown card "${id}"`);
  }
  if (errors.length > 0) throw new Error(`The loot tables have problems:\n- ${errors.join('\n- ')}`);
  return loot;
}

export function loadEnemies(raw: unknown): Map<string, EnemyDef> {
  return uniqueById('enemy', z.array(enemySchema).parse(raw));
}
