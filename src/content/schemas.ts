import { z } from 'zod';
import type { CardDef, EnemyDef, Effect } from '../engine';

const condition = z.enum(['bleed', 'stun', 'root', 'weak']);

const effect: z.ZodType<Effect> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), range: z.number().int().positive() }),
  z.strictObject({
    kind: z.literal('attack'),
    damage: z.number().int().nonnegative(),
    range: z.number().int().positive(),
    allAdjacent: z.boolean().optional(),
    push: z.number().int().positive().optional(),
    conditions: z.array(condition).optional(),
  }),
  z.strictObject({ kind: z.literal('heal'), amount: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('shield'), amount: z.number().int().positive() }),
]);

const initiative = z.number().int().min(1).max(99);

export const cardSchema: z.ZodType<CardDef> = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  initiative,
  staminaCost: z.number().int().nonnegative(),
  effects: z.array(effect).min(1),
});

export const enemySchema: z.ZodType<EnemyDef> = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  hp: z.number().int().positive(),
  behaviors: z.array(z.strictObject({ name: z.string().min(1), initiative, effects: z.array(effect).min(1) })).min(1),
});

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
