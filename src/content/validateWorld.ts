import { rectContains, samePos, TILE_PROPS } from '../engine';
import type { LevelDef, Pos, Tile } from '../engine';

/** The most a fight's area can be and still fit on screen, in tiles. */
export const VIEW_TILES = { width: 14, height: 10 };

const NEIGHBORS: Pos[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

function flood(level: LevelDef, from: Pos, allowed: (p: Pos) => boolean = () => true): Set<string> {
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as Pos;
    for (const n of NEIGHBORS) {
      const next = { x: cur.x + n.x, y: cur.y + n.y };
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || !allowed(next) || !walkable(level, next)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

function tileOf(level: LevelDef, p: Pos): Tile {
  if (p.x < 0 || p.y < 0 || p.x >= level.width || p.y >= level.height) return 'wall';
  return level.tiles[p.y * level.width + p.x] ?? 'wall';
}

const walkable = (level: LevelDef, p: Pos): boolean => TILE_PROPS[tileOf(level, p)].walkable;

/** Returns every authoring mistake found, so a map can be fixed in one pass. */
export function validateWorld(
  levels: Record<string, LevelDef>,
  start: { levelId: string; pos: Pos },
  enemyIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const startLevel = levels[start.levelId];
  if (!startLevel) return [`Start level "${start.levelId}" does not exist`];
  if (!walkable(startLevel, start.pos)) errors.push('The player starts on a tile that blocks movement');

  for (const level of Object.values(levels)) {
    const at = (p: Pos) => `${level.id} (${p.x},${p.y})`;
    if (level.tiles.length !== level.width * level.height) errors.push(`${level.id}: tile count doesn't match its size`);

    for (const t of level.transitions) {
      if (!walkable(level, t.pos)) errors.push(`${at(t.pos)}: transition "${t.tag}" is not walkable`);
      if (level.encounters.some((e) => rectContains(e.area, t.pos))) errors.push(`${at(t.pos)}: transition "${t.tag}" is inside an encounter`);
      const target = levels[t.targetLevel]?.transitions.find((other) => other.tag === t.targetTag);
      if (!target) errors.push(`${at(t.pos)}: transition "${t.tag}" targets missing "${t.targetLevel}/${t.targetTag}"`);
    }

    level.encounters.forEach((encounter, index) => {
      const { area } = encounter;
      const name = `${level.id} encounter at (${area.x},${area.y})`;
      if (area.x < 0 || area.y < 0 || area.x + area.width > level.width || area.y + area.height > level.height) {
        errors.push(`${name}: runs off the level`);
      }
      if (area.width > VIEW_TILES.width || area.height > VIEW_TILES.height) {
        errors.push(`${name}: is larger than the ${VIEW_TILES.width}x${VIEW_TILES.height} screen`);
      }
      if (encounter.enemies.length === 0) errors.push(`${name}: has no enemies`);
      if (encounter.exits.length === 0) errors.push(`${name}: has no exits`);
      for (const enemy of encounter.enemies) {
        if (!enemyIds.has(enemy.defId)) errors.push(`${name}: unknown enemy "${enemy.defId}"`);
        if (!walkable(level, enemy.pos)) errors.push(`${name}: an enemy stands on blocked terrain at (${enemy.pos.x},${enemy.pos.y})`);
        if (encounter.exits.some((exit) => samePos(exit, enemy.pos))) errors.push(`${name}: an enemy stands on an exit`);
      }
      for (const exit of encounter.exits) {
        if (!walkable(level, exit)) errors.push(`${name}: exit at (${exit.x},${exit.y}) is on blocked terrain`);
      }
      level.encounters.slice(index + 1).forEach((other) => {
        const overlaps = area.x < other.area.x + other.area.width && other.area.x < area.x + area.width
          && area.y < other.area.y + other.area.height && other.area.y < area.y + area.height;
        if (overlaps) errors.push(`${name}: overlaps another encounter`);
      });

      // Every tile a fight could reach must have a way out.
      const inArea = (p: Pos) => rectContains(area, p);
      const safe = new Set<string>();
      for (const exit of encounter.exits) for (const key of flood(level, exit, inArea)) safe.add(key);
      for (let y = area.y; y < area.y + area.height; y++) {
        for (let x = area.x; x < area.x + area.width; x++) {
          if (walkable(level, { x, y }) && !safe.has(`${x},${y}`)) {
            errors.push(`${name}: no exit can be reached from (${x},${y})`);
          }
        }
      }
    });
  }

  // Every level must be reachable on foot, ignoring enemies, which can be beaten.
  const visited = new Set<string>();
  const visit = (levelId: string, from: Pos) => {
    const level = levels[levelId];
    if (!level || visited.has(`${levelId}:${from.x},${from.y}`)) return;
    const reached = flood(level, from);
    for (const key of reached) visited.add(`${levelId}:${key}`);
    for (const t of level.transitions) {
      if (!reached.has(`${t.pos.x},${t.pos.y}`)) continue;
      const target = levels[t.targetLevel]?.transitions.find((other) => other.tag === t.targetTag);
      if (target) visit(t.targetLevel, target.pos);
    }
  };
  visit(start.levelId, start.pos);
  for (const id of Object.keys(levels)) {
    if (![...visited].some((key) => key.startsWith(`${id}:`))) errors.push(`${id}: can't be reached from the start`);
  }
  return errors;
}
