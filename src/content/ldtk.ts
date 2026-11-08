import { z } from 'zod';
import { rectContains } from '../engine';
import type { EncounterDef, LevelDef, Pos, Tile, TransitionDef } from '../engine';

const GRID_VALUES: Record<number, Tile> = {
  0: 'wall', // Unpainted cells are solid, so a dungeon is carved out of nothing.
  1: 'floor', 2: 'grass', 3: 'wall', 4: 'tree', 5: 'water', 6: 'trap', 7: 'door',
};

const field = z.object({ __identifier: z.string(), __value: z.unknown() });
const entityInstance = z.object({
  __identifier: z.string(),
  __grid: z.tuple([z.number(), z.number()]),
  iid: z.string(),
  width: z.number(),
  height: z.number(),
  fieldInstances: z.array(field),
});
const layerInstance = z.object({
  __identifier: z.string(),
  __gridSize: z.number(),
  __cWid: z.number(),
  __cHei: z.number(),
  intGridCsv: z.array(z.number()),
  entityInstances: z.array(entityInstance),
});
const ldtkProject = z.object({
  levels: z.array(z.object({
    identifier: z.string(),
    fieldInstances: z.array(field),
    layerInstances: z.array(layerInstance).nullable(),
  })),
});

type Entity = z.infer<typeof entityInstance>;

function stringField(entity: Entity, name: string, where: string): string {
  const value = entity.fieldInstances.find((f) => f.__identifier === name)?.__value;
  if (typeof value !== 'string' || value === '') throw new Error(`${where}: ${entity.__identifier} needs a "${name}" value`);
  return value;
}

export interface LoadedMaps {
  levels: Record<string, LevelDef>;
  start: { levelId: string; pos: Pos };
}

/** Reads an LDtk project. Only the fields the game uses are looked at. */
export function loadLdtkProject(raw: string): LoadedMaps {
  const project = ldtkProject.parse(JSON.parse(raw));
  const levels: Record<string, LevelDef> = {};
  const starts: { levelId: string; pos: Pos }[] = [];

  for (const source of project.levels) {
    const id = source.identifier;
    const layer = (name: string) => {
      const found = source.layerInstances?.find((l) => l.__identifier === name);
      if (!found) throw new Error(`${id}: missing the "${name}" layer`);
      return found;
    };
    const terrain = layer('Terrain');
    const entities = layer('Entities').entityInstances;
    const named = (name: string) => entities.filter((e) => e.__identifier === name);
    const pos = (e: Entity): Pos => ({ x: e.__grid[0], y: e.__grid[1] });
    const levelField = (name: string) => source.fieldInstances.find((f) => f.__identifier === name)?.__value;

    const tiles = terrain.intGridCsv.map((value) => {
      const tile = GRID_VALUES[value];
      if (!tile) throw new Error(`${id}: unknown terrain value ${value}`);
      return tile;
    });

    const encounters: EncounterDef[] = named('Encounter').map((e) => ({
      id: e.iid,
      area: {
        x: e.__grid[0], y: e.__grid[1],
        width: Math.round(e.width / terrain.__gridSize), height: Math.round(e.height / terrain.__gridSize),
      },
      exits: [],
      enemies: [],
      zone: stringField(e, 'zone', id),
    }));
    const encounterAt = (e: Entity): EncounterDef => {
      const found = encounters.find((enc) => rectContains(enc.area, pos(e)));
      if (!found) throw new Error(`${id}: ${e.__identifier} at ${e.__grid.join(',')} is outside every Encounter`);
      return found;
    };
    for (const e of named('Enemy')) encounterAt(e).enemies.push({ defId: stringField(e, 'defId', id), pos: pos(e) });
    for (const e of named('Exit')) encounterAt(e).exits.push(pos(e));

    const transitions: TransitionDef[] = named('Transition').map((e) => ({
      tag: stringField(e, 'tag', id),
      pos: pos(e),
      targetLevel: stringField(e, 'targetLevel', id),
      targetTag: stringField(e, 'targetTag', id),
    }));

    const name = levelField('name');
    levels[id] = {
      id,
      name: typeof name === 'string' && name ? name : id,
      dark: levelField('dark') === true,
      width: terrain.__cWid,
      height: terrain.__cHei,
      tiles,
      transitions,
      encounters,
    };
    for (const e of named('PlayerStart')) starts.push({ levelId: id, pos: pos(e) });
  }

  const start = starts[0];
  if (starts.length !== 1 || !start) throw new Error(`The project needs exactly one PlayerStart, found ${starts.length}`);
  return { levels, start };
}

