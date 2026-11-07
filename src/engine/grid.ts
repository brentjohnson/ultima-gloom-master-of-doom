import { TILE_PROPS } from './types';
import type { CombatState, Figure, Pos, Tile, TileGrid } from './types';

const NEIGHBORS: readonly Pos[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;
export const distance = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Index into `grid.tiles`, or -1 outside the grid. */
export function tileIndex(grid: TileGrid, p: Pos): number {
  const x = p.x - grid.originX;
  const y = p.y - grid.originY;
  return x < 0 || y < 0 || x >= grid.width || y >= grid.height ? -1 : y * grid.width + x;
}

/** Anything outside the grid counts as wall, which is what bounds a fight. */
export function tileAt(grid: TileGrid, p: Pos): Tile {
  return grid.tiles[tileIndex(grid, p)] ?? 'wall';
}

export const livingFigures = (state: CombatState): Figure[] => state.figures.filter((f) => f.hp > 0);
export const figureAt = (state: CombatState, p: Pos): Figure | undefined =>
  livingFigures(state).find((f) => samePos(f.pos, p));

export function isStandable(state: CombatState, p: Pos): boolean {
  return TILE_PROPS[tileAt(state, p)].walkable && !figureAt(state, p);
}

function bresenhamClear(grid: TileGrid, a: Pos, b: Pos): boolean {
  let { x, y } = a;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if ((x !== b.x || y !== b.y) && TILE_PROPS[tileAt(grid, { x, y })].blocksSight) return false;
  }
  return true;
}

/** Checked both ways so sight is always symmetric. */
export const hasLineOfSight = (grid: TileGrid, a: Pos, b: Pos): boolean =>
  bresenhamClear(grid, a, b) || bresenhamClear(grid, b, a);

/** Distances from `from` over standable tiles, up to `maxSteps`. */
function floodDistances(state: CombatState, from: Pos, maxSteps: number, avoidTraps: boolean) {
  const key = (p: Pos) => p.y * 100_000 + p.x;
  const parents = new Map<number, Pos | null>([[key(from), null]]);
  const dist = new Map<number, number>([[key(from), 0]]);
  const queue: Pos[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as Pos;
    const d = dist.get(key(cur)) as number;
    if (d >= maxSteps) continue;
    for (const n of NEIGHBORS) {
      const next = { x: cur.x + n.x, y: cur.y + n.y };
      if (parents.has(key(next)) || !isStandable(state, next)) continue;
      if (avoidTraps && tileAt(state, next) === 'trap') continue;
      parents.set(key(next), cur);
      dist.set(key(next), d + 1);
      queue.push(next);
    }
  }
  const pathTo = (to: Pos): Pos[] | null => {
    if (!parents.has(key(to))) return null;
    const path: Pos[] = [];
    let cur: Pos | null = to;
    while (cur && !samePos(cur, from)) {
      path.unshift(cur);
      cur = parents.get(key(cur)) ?? null;
    }
    return path;
  };
  return { queue, pathTo };
}

/** Shortest path within range, walking over a trap only if no trap-free path fits. */
export function findPath(state: CombatState, from: Pos, to: Pos, range: number): Pos[] | null {
  return floodDistances(state, from, range, true).pathTo(to)
    ?? floodDistances(state, from, range, false).pathTo(to);
}

export function reachableTiles(state: CombatState, from: Pos, range: number): Pos[] {
  return floodDistances(state, from, range, false).queue.filter((p) => !samePos(p, from));
}

/** Tiles a blink can land on: standable, in range and in sight. */
export function blinkTargets(state: CombatState, from: Pos, range: number): Pos[] {
  const targets: Pos[] = [];
  for (let y = state.originY; y < state.originY + state.height; y++) {
    for (let x = state.originX; x < state.originX + state.width; x++) {
      const p = { x, y };
      if (!samePos(p, from) && distance(p, from) <= range && isStandable(state, p) && hasLineOfSight(state, from, p)) targets.push(p);
    }
  }
  return targets;
}

/**
 * Enemy pathing: the path to the nearest tile from which `target` can be
 * attacked at `attackRange`, truncated to `moveRange`. Enemies avoid traps.
 */
export function pathTowardAttack(
  state: CombatState, from: Pos, target: Pos, attackRange: number, moveRange: number,
): Pos[] {
  const inPosition = (p: Pos) => distance(p, target) <= attackRange && hasLineOfSight(state, p, target);
  if (inPosition(from)) return [];
  const limit = state.width * state.height;
  const { queue, pathTo } = floodDistances(state, from, limit, true);
  const goal = queue.find(inPosition);
  return goal ? (pathTo(goal) ?? []).slice(0, moveRange) : [];
}

export function pushPath(state: CombatState, target: Figure, source: Pos, amount: number): Pos[] {
  const dx = Math.sign(target.pos.x - source.x);
  const dy = Math.sign(target.pos.y - source.y);
  // Pushes follow the dominant axis so diagonal shots still shove in a straight line.
  const horizontal = Math.abs(target.pos.x - source.x) >= Math.abs(target.pos.y - source.y);
  const step = horizontal ? { x: dx, y: 0 } : { x: 0, y: dy };
  const path: Pos[] = [];
  let cur = target.pos;
  for (let i = 0; i < amount; i++) {
    const next = { x: cur.x + step.x, y: cur.y + step.y };
    if (!isStandable(state, next)) break;
    path.push(next);
    cur = next;
  }
  return path;
}
