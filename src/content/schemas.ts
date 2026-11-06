import { z } from 'zod';
import type { BasicDef, BasicId, CardDef, EnemyDef, Effect } from '../engine';

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

export function loadEnemies(raw: unknown): Map<string, EnemyDef> {
  return uniqueById('enemy', z.array(enemySchema).parse(raw));
}
