#!/usr/bin/env node
// Writes a first version of maps/world.ldtk, because the LDtk editor can't be
// driven from code. Rerunning this overwrites edits made in LDtk, so once a map
// is being edited by hand, edit it there instead.
import { writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const GRID = 16;
const TERRAIN = {
  floor: { value: 1, color: '#3A3F4B' },
  grass: { value: 2, color: '#3F6B3A' },
  wall: { value: 3, color: '#7D8596' },
  tree: { value: 4, color: '#1F4A2A' },
  water: { value: 5, color: '#4F8FD6' },
  trap: { value: 6, color: '#E0663F' },
  door: { value: 7, color: '#C49A5A' },
};

let nextUid = 1;
const uid = () => nextUid++;
let nextIid = 1;
const iid = () => `00000000-0000-4000-8000-${String(nextIid++).padStart(12, '0')}`;

const fieldDef = (identifier) => ({
  identifier, __type: identifier === 'dark' ? 'Bool' : 'String', uid: uid(),
  type: identifier === 'dark' ? 'F_Bool' : 'F_String',
  isArray: false, canBeNull: false, arrayMinLength: null, arrayMaxLength: null,
  editorDisplayMode: 'NameAndValue', editorDisplayScale: 1, editorDisplayPos: 'Above', editorLinkStyle: 'StraightArrow',
  editorDisplayColor: null, editorAlwaysShow: false, editorShowInWorld: true, editorCutLongValues: true,
  editorTextSuffix: null, editorTextPrefix: null, useForSmartColor: false, exportToToc: false, searchable: false,
  min: null, max: null, regex: null, acceptFileTypes: null,
  defaultOverride: identifier === 'dark' ? { id: 'V_Bool', params: [false] } : null,
  textLanguageMode: null, symmetricalRef: false, autoChainRef: true, allowOutOfLevelRef: true,
  allowedRefs: 'OnlySame', allowedRefsEntityUid: null, allowedRefTags: [], tilesetUid: null,
});

const entityDef = (identifier, color, fields, resizable = false) => ({
  identifier, uid: uid(), tags: [], exportToToc: false, allowOutOfBounds: false, doc: null,
  width: GRID, height: GRID, resizableX: resizable, resizableY: resizable, minWidth: null, maxWidth: null,
  minHeight: null, maxHeight: null, keepAspectRatio: false, tileOpacity: 1, fillOpacity: resizable ? 0.08 : 0.5,
  lineOpacity: 1, hollow: false, color, renderMode: 'Rectangle', showName: true, tilesetId: null,
  tileRenderMode: 'FitInside', tileRect: null, uiTileRect: null, nineSliceBorders: [],
  maxCount: identifier === 'PlayerStart' ? 1 : 0, limitScope: 'PerLevel', limitBehavior: 'MoveLastOne',
  pivotX: 0, pivotY: 0, fieldDefs: fields.map(fieldDef),
});

const layerCommon = {
  doc: null, uiColor: null, pxOffsetX: 0, pxOffsetY: 0, parallaxFactorX: 0, parallaxFactorY: 0, parallaxScaling: true,
  requiredTags: [], excludedTags: [], autoRuleGroups: [], uiFilterTags: [], useAsyncRender: false,
  autoSourceLayerDefUid: null, tilesetDefUid: null, tilePivotX: 0, tilePivotY: 0, biomeFieldUid: null,
  hideInList: false, hideFieldsWhenInactive: true, canSelectWhenInactive: true, renderInWorldView: true,
  displayOpacity: 1, inactiveOpacity: 1, guideGridWid: 0, guideGridHei: 0, gridSize: GRID,
};

const entitiesLayerDef = { ...layerCommon, __type: 'Entities', identifier: 'Entities', type: 'Entities', uid: uid(), intGridValues: [], intGridValuesGroups: [] };
const terrainLayerDef = {
  ...layerCommon, __type: 'IntGrid', identifier: 'Terrain', type: 'IntGrid', uid: uid(),
  intGridValues: Object.entries(TERRAIN).map(([identifier, t]) => ({ value: t.value, identifier, color: t.color, tile: null, groupUid: 0 })),
  intGridValuesGroups: [],
};

const entityDefs = {
  PlayerStart: entityDef('PlayerStart', '#F4E9C1', []),
  Encounter: entityDef('Encounter', '#E0403F', ['zone'], true),
  Enemy: entityDef('Enemy', '#9FCE5A', ['defId']),
  Exit: entityDef('Exit', '#7FD67F', []),
  Transition: entityDef('Transition', '#F2D94E', ['tag', 'targetLevel', 'targetTag']),
};
const levelFieldDefs = { name: fieldDef('name'), dark: fieldDef('dark') };

const fieldInstance = (def, value) => ({
  __identifier: def.identifier, __type: def.__type, __value: value, __tile: null, defUid: def.uid,
  realEditorValues: [{ id: def.__type === 'Bool' ? 'V_Bool' : 'V_String', params: [value] }],
});

function entity(identifier, x, y, fields = {}, size = { width: 1, height: 1 }) {
  const def = entityDefs[identifier];
  return {
    __identifier: identifier, __grid: [x, y], __pivot: [0, 0], __tags: [], __tile: null, __smartColor: def.color,
    __worldX: x * GRID, __worldY: y * GRID, iid: iid(), width: size.width * GRID, height: size.height * GRID, defUid: def.uid,
    px: [x * GRID, y * GRID],
    fieldInstances: def.fieldDefs.map((f) => fieldInstance(f, fields[f.identifier])),
  };
}

let worldX = 0;
function level({ id, name, dark, width, height, draw, entities }) {
  const cells = new Array(width * height).fill(0);
  const rect = (terrain, x, y, w, h) => {
    for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) cells[cy * width + cx] = TERRAIN[terrain].value;
  };
  draw(rect);
  const levelUid = uid();
  const layer = (def, extra) => ({
    __identifier: def.identifier, __type: def.__type, __cWid: width, __cHei: height, __gridSize: GRID, __opacity: 1,
    __pxTotalOffsetX: 0, __pxTotalOffsetY: 0, __tilesetDefUid: null, __tilesetRelPath: null, iid: iid(), levelId: levelUid,
    layerDefUid: def.uid, pxOffsetX: 0, pxOffsetY: 0, visible: true, optionalRules: [], overrideTilesetUid: null, seed: 0,
    autoLayerTiles: [], gridTiles: [], entityInstances: [], intGridCsv: [], ...extra,
  });
  const result = {
    identifier: id, iid: iid(), uid: levelUid, worldX, worldY: 0, worldDepth: 0,
    pxWid: width * GRID, pxHei: height * GRID, __bgColor: '#14161C', bgColor: null, useAutoIdentifier: false,
    bgRelPath: null, bgPos: null, bgPivotX: 0.5, bgPivotY: 0.5, __smartColor: '#ADADB5', __bgPos: null,
    externalRelPath: null, __neighbours: [],
    fieldInstances: [fieldInstance(levelFieldDefs.name, name), fieldInstance(levelFieldDefs.dark, dark)],
    layerInstances: [
      layer(entitiesLayerDef, { entityInstances: entities() }),
      layer(terrainLayerDef, { intGridCsv: cells }),
    ],
  };
  worldX += (width + 4) * GRID;
  return result;
}

const levels = [
  level({
    id: 'Wilds', name: 'The Wilds', dark: false, width: 40, height: 24,
    draw(rect) {
      rect('grass', 0, 0, 40, 24);
      for (const [x, y, w, h] of [[0, 0, 40, 1], [0, 23, 40, 1], [0, 0, 1, 24], [39, 0, 1, 24]]) rect('tree', x, y, w, h);
      rect('tree', 8, 3, 5, 3);
      rect('tree', 5, 17, 6, 3);
      rect('water', 14, 6, 6, 4);
      rect('floor', 2, 12, 32, 1); // The road.
      rect('wall', 30, 3, 7, 7); // The ruin.
      rect('floor', 31, 4, 5, 5);
      rect('door', 33, 9, 1, 1);
      rect('floor', 33, 10, 1, 2);
      rect('tree', 25, 10, 1, 1);
      rect('tree', 27, 14, 1, 1);
      rect('trap', 14, 15, 1, 1);
    },
    entities: () => [
      entity('PlayerStart', 4, 12),
      entity('Encounter', 21, 10, { zone: 'wilds' }, { width: 8, height: 6 }),
      entity('Enemy', 25, 12, { defId: 'mire-skulker' }),
      entity('Exit', 21, 12),
      entity('Exit', 28, 12),
      entity('Transition', 33, 5, { tag: 'ruin-down', targetLevel: 'Crypt', targetTag: 'ruin-up' }),
    ],
  }),
  level({
    id: 'Crypt', name: 'The Sunken Crypt', dark: true, width: 24, height: 16,
    draw(rect) {
      rect('wall', 0, 0, 24, 16);
      rect('floor', 2, 2, 6, 5);
      rect('floor', 8, 4, 4, 1);
      rect('door', 9, 4, 1, 1);
      rect('floor', 12, 1, 10, 9);
      rect('trap', 15, 3, 1, 1);
      rect('trap', 15, 6, 1, 1);
      rect('floor', 16, 10, 1, 3);
      rect('trap', 16, 11, 1, 1);
      rect('floor', 10, 13, 11, 2);
    },
    entities: () => [
      entity('Transition', 3, 3, { tag: 'ruin-up', targetLevel: 'Wilds', targetTag: 'ruin-down' }),
      entity('Encounter', 12, 1, { zone: 'crypt' }, { width: 10, height: 9 }),
      entity('Enemy', 17, 3, { defId: 'mire-skulker' }),
      entity('Enemy', 18, 7, { defId: 'mire-skulker' }),
      entity('Enemy', 20, 5, { defId: 'hollow-archer' }),
      entity('Exit', 12, 4),
      entity('Exit', 16, 9),
    ],
  }),
];

const project = {
  __header__: {
    fileType: 'LDtk Project JSON', app: 'LDtk', doc: 'https://ldtk.io/json', schema: 'https://ldtk.io/files/JSON_SCHEMA.json',
    appAuthor: 'Sebastien Benard', appVersion: '1.5.3', url: 'https://ldtk.io',
  },
  iid: '00000000-0000-4000-8000-000000000000', jsonVersion: '1.5.3', appBuildId: 473703, nextUid: 0,
  identifierStyle: 'Free', toc: [], worldLayout: 'Free', worldGridWidth: 256, worldGridHeight: 256,
  defaultLevelWidth: 640, defaultLevelHeight: 384, defaultPivotX: 0, defaultPivotY: 0, defaultGridSize: GRID,
  defaultEntityWidth: GRID, defaultEntityHeight: GRID, bgColor: '#14161C', defaultLevelBgColor: '#14161C',
  minifyJson: false, externalLevels: false, exportTiled: false, simplifiedExport: false, imageExportMode: 'None',
  exportLevelBg: true, pngFilePattern: null, backupOnSave: false, backupLimit: 10, backupRelPath: null,
  levelNamePattern: '%world_Level_%idx', tutorialDesc: null, customCommands: [], flags: [],
  defs: {
    layers: [entitiesLayerDef, terrainLayerDef],
    entities: Object.values(entityDefs),
    tilesets: [], enums: [], externalEnums: [],
    levelFields: Object.values(levelFieldDefs),
  },
  levels, worlds: [], dummyWorldIid: '00000000-0000-4000-8000-ffffffffffff',
};
project.nextUid = nextUid;

writeFileSync(new URL('../maps/world.ldtk', import.meta.url), `${JSON.stringify(project, null, 1)}\n`);
