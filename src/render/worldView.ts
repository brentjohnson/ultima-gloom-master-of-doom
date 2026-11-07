import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { hasLineOfSight, rectContains } from '../engine';
import type { AnyEvent, Condition, Modifier, Pos, Rect, Tile, TileGrid } from '../engine';
import { VIEW_TILES } from '../content/validateWorld';
import { buildTextures, TILE_PIXELS, type SpriteName } from './sprites';

const SCALE = 3;
const TILE = TILE_PIXELS * SCALE;

/** How far the player can see in a dark level, in tiles. */
const LIGHT_RADIUS = 5;

const CONDITION_COLORS = { bleed: 0xe0403f, stun: 0xf2d94e, root: 0x6fbf5a, weak: 0xa98be0 } as const;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `tick` with progress 0..1 over `ms`. */
function tween(ms: number, tick: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      tick(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export function modifierLabel(modifier: Modifier): string {
  if (modifier.kind === 'null') return 'MISS';
  if (modifier.kind === 'double') return 'x2';
  return modifier.value >= 0 ? `+${modifier.value}` : `${modifier.value}`;
}

export interface FigureInfo {
  id: string;
  name: string;
  /** Also the sprite name: 'player' or an enemy definition id. */
  defId: string;
  pos: Pos;
  hp: number;
  maxHp: number;
  conditions: Condition[];
}

/** Everything the view needs to draw one moment of the game. */
export interface Scene {
  levelId: string;
  grid: TileGrid;
  dark: boolean;
  figures: FigureInfo[];
  playerPos: Pos;
  /** Marked tiles drawn over the terrain. */
  markers: { pos: Pos; sprite: SpriteName }[];
  /** The fight in progress, if any. Everything outside it is dimmed. */
  combatArea: Rect | null;
}

interface FigureView { root: Container; hpBar: Graphics; pips: Graphics; maxHp: number }

const OVERLAYS: Partial<Record<Tile, SpriteName>> = {
  grass: 'grass', wall: 'wall', tree: 'tree', water: 'water', trap: 'trap', door: 'door', openDoor: 'openDoor',
};

/** Draws scenes and plays events. Holds no rules of its own. */
export class WorldView {
  private readonly textures = buildTextures();
  private readonly world = new Container();
  private readonly tileLayer = new Container();
  private readonly markerLayer = new Container();
  private readonly highlightLayer = new Graphics();
  private readonly figureLayer = new Container();
  private readonly shadeLayer = new Graphics();
  private readonly fxLayer = new Container();
  private readonly figures = new Map<string, FigureView>();
  private readonly tileSprites = new Map<number, Sprite>();
  private tiles: Tile[] = [];
  private levelId: string | null = null;
  private levelSize = { width: 0, height: 0 };
  private scene: Scene | null = null;

  private constructor(app: Application, private readonly onTile: (pos: Pos) => void) {
    this.world.addChild(this.tileLayer, this.markerLayer, this.highlightLayer, this.figureLayer, this.shadeLayer, this.fxLayer);
    app.stage.addChild(this.world);
    app.stage.eventMode = 'static';
    app.stage.on('pointertap', (e) => {
      this.onTile({
        x: Math.floor((e.global.x - this.world.x) / TILE),
        y: Math.floor((e.global.y - this.world.y) / TILE),
      });
    });
  }

  static async create(host: HTMLElement, onTile: (pos: Pos) => void): Promise<WorldView> {
    const app = new Application();
    await app.init({
      width: VIEW_TILES.width * TILE,
      height: VIEW_TILES.height * TILE,
      background: '#000000',
      antialias: false,
      preference: 'webgl',
    });
    app.stage.hitArea = app.screen;
    host.replaceChildren(app.canvas);
    return new WorldView(app, onTile);
  }

  /** Snaps the display to exactly match `scene`. */
  show(scene: Scene): void {
    this.scene = scene;
    if (scene.levelId !== this.levelId) this.loadLevel(scene);
    else this.updateTiles(scene.grid);
    this.showMarkers(scene);
    this.showFigures(scene);
    this.setCamera(this.cameraTarget(scene));
    this.drawShade();
  }

  private loadLevel(scene: Scene): void {
    this.tileLayer.removeChildren().forEach((child) => child.destroy());
    this.tileSprites.clear();
    this.levelId = scene.levelId;
    const { width, height, tiles } = scene.grid;
    this.levelSize = { width, height };
    this.tiles = [...tiles];
    for (let i = 0; i < tiles.length; i++) {
      const floor = new Sprite(this.textures.floor);
      floor.scale.set(SCALE);
      floor.position.set((i % width) * TILE, Math.floor(i / width) * TILE);
      this.tileLayer.addChild(floor);
      this.placeOverlay(i, tiles[i] as Tile);
    }
  }

  private placeOverlay(index: number, tile: Tile): void {
    this.tileSprites.get(index)?.destroy();
    this.tileSprites.delete(index);
    const name = OVERLAYS[tile];
    if (!name) return;
    const sprite = new Sprite(this.textures[name]);
    sprite.scale.set(SCALE);
    sprite.position.set((index % this.levelSize.width) * TILE, Math.floor(index / this.levelSize.width) * TILE);
    this.tileLayer.addChild(sprite);
    this.tileSprites.set(index, sprite);
  }

  private updateTiles(grid: TileGrid): void {
    grid.tiles.forEach((tile, i) => {
      if (this.tiles[i] !== tile) {
        this.tiles[i] = tile;
        this.placeOverlay(i, tile);
      }
    });
  }

  private setTile(pos: Pos, tile: Tile): void {
    const index = pos.y * this.levelSize.width + pos.x;
    this.tiles[index] = tile;
    this.placeOverlay(index, tile);
  }

  private showMarkers(scene: Scene): void {
    this.markerLayer.removeChildren().forEach((child) => child.destroy());
    for (const { pos, sprite } of scene.markers) {
      const marker = new Sprite(this.textures[sprite]);
      marker.scale.set(SCALE);
      marker.position.set(pos.x * TILE, pos.y * TILE);
      this.markerLayer.addChild(marker);
    }
  }

  private showFigures(scene: Scene): void {
    const wanted = new Set(scene.figures.map((f) => f.id));
    for (const [id, view] of this.figures) {
      if (!wanted.has(id)) {
        view.root.destroy({ children: true });
        this.figures.delete(id);
      }
    }
    for (const figure of scene.figures) {
      const view = this.figures.get(figure.id) ?? this.addFigure(figure);
      view.root.visible = figure.hp > 0 && this.canSee(figure.pos);
      view.root.alpha = 1;
      view.root.tint = 0xffffff;
      view.root.position.set(figure.pos.x * TILE, figure.pos.y * TILE);
      view.maxHp = figure.maxHp;
      this.drawHp(view, figure.hp);
      view.pips.clear();
      figure.conditions.forEach((c, i) => view.pips.rect(2 + i * 8, 2, 6, 6).fill(CONDITION_COLORS[c]));
    }
  }

  private addFigure(figure: FigureInfo): FigureView {
    const root = new Container();
    const sprite = new Sprite(this.textures[figure.defId as SpriteName]);
    sprite.scale.set(SCALE);
    const hpBar = new Graphics();
    const pips = new Graphics();
    root.addChild(sprite, hpBar, pips);
    const number = /(\d+)$/.exec(figure.name)?.[1];
    if (number) {
      const tag = new Text({
        text: number,
        style: { fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold', fill: '#ffffff', stroke: { color: 0x000000, width: 3 } },
      });
      tag.position.set(TILE - 11, 0);
      root.addChild(tag);
    }
    this.figureLayer.addChild(root);
    const view = { root, hpBar, pips, maxHp: figure.maxHp };
    this.figures.set(figure.id, view);
    return view;
  }

  private drawHp(view: FigureView, hp: number): void {
    const ratio = hp / view.maxHp;
    view.hpBar.clear();
    view.hpBar.rect(2, TILE - 6, TILE - 4, 5).fill(0x000000);
    view.hpBar.rect(3, TILE - 5, Math.max(0, (TILE - 6) * ratio), 3).fill(ratio > 0.4 ? 0x5fd35f : 0xe0403f);
  }

  /** Fights frame their whole area; otherwise the camera follows the player. */
  private cameraTarget(scene: Scene): Pos {
    const area = scene.combatArea;
    return area ? { x: area.x + area.width / 2 - 0.5, y: area.y + area.height / 2 - 0.5 } : scene.playerPos;
  }

  private cameraOffset(target: Pos): Pos {
    const axis = (center: number, levelSize: number, viewSize: number) => {
      // A level smaller than the view is centered in it.
      if (levelSize <= viewSize) return ((viewSize - levelSize) / 2) * TILE;
      const left = center - (viewSize - 1) / 2;
      return -Math.min(levelSize - viewSize, Math.max(0, left)) * TILE;
    };
    return {
      x: Math.round(axis(target.x, this.levelSize.width, VIEW_TILES.width)),
      y: Math.round(axis(target.y, this.levelSize.height, VIEW_TILES.height)),
    };
  }

  private setCamera(target: Pos): void {
    const { x, y } = this.cameraOffset(target);
    this.world.position.set(x, y);
  }

  private async moveCamera(target: Pos, ms: number): Promise<void> {
    const to = this.cameraOffset(target);
    const fromX = this.world.x;
    const fromY = this.world.y;
    if (fromX === to.x && fromY === to.y) return;
    await tween(ms, (t) => this.world.position.set(fromX + (to.x - fromX) * t, fromY + (to.y - fromY) * t));
  }

  /** Whether a dark level's gloom hides this tile. Lit levels and fights hide nothing. */
  private canSee(pos: Pos): boolean {
    const scene = this.scene;
    if (!scene || !scene.dark || scene.combatArea) return true;
    const d = Math.abs(pos.x - scene.playerPos.x) + Math.abs(pos.y - scene.playerPos.y);
    return d <= LIGHT_RADIUS && hasLineOfSight(scene.grid, scene.playerPos, pos);
  }

  /** Darkens the level, and everything outside the fight while one is on. */
  private drawShade(): void {
    const scene = this.scene;
    const g = this.shadeLayer;
    g.clear();
    if (!scene) return;
    const { width, height } = scene.grid;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = { x, y };
        let alpha = 0;
        if (scene.combatArea) {
          if (!rectContains(scene.combatArea, p)) alpha = scene.dark ? 0.92 : 0.6;
        } else if (scene.dark) {
          const d = Math.abs(x - scene.playerPos.x) + Math.abs(y - scene.playerPos.y);
          const lit = d <= LIGHT_RADIUS && hasLineOfSight(scene.grid, scene.playerPos, p);
          alpha = lit ? (d / LIGHT_RADIUS) * 0.55 : 0.92;
        }
        if (alpha > 0) g.rect(x * TILE, y * TILE, TILE, TILE).fill({ color: 0x000000, alpha });
      }
    }
  }

  /** Marks legal choices: green to move, red to attack, yellow to stay where you are. */
  setHighlights(moves: Pos[], targets: Pos[], stay: Pos | null = null): void {
    const g = this.highlightLayer;
    g.clear();
    for (const p of moves) g.rect(p.x * TILE + 1, p.y * TILE + 1, TILE - 2, TILE - 2).fill({ color: 0x5fd35f, alpha: 0.25 }).stroke({ color: 0x5fd35f, alpha: 0.7, width: 1 });
    for (const p of targets) g.rect(p.x * TILE + 1, p.y * TILE + 1, TILE - 2, TILE - 2).fill({ color: 0xe0403f, alpha: 0.3 }).stroke({ color: 0xe0403f, width: 2 });
    if (stay) g.rect(stay.x * TILE + 1, stay.y * TILE + 1, TILE - 2, TILE - 2).stroke({ color: 0xf2d94e, width: 2 });
  }

  private async slide(figureId: string, path: Pos[], stepMs: number): Promise<void> {
    const root = this.figures.get(figureId)?.root;
    if (!root) return;
    for (const p of path) {
      const fromX = root.x;
      const fromY = root.y;
      await tween(stepMs, (t) => root.position.set(fromX + (p.x * TILE - fromX) * t, fromY + (p.y * TILE - fromY) * t));
    }
  }

  private float(figureId: string, text: string, color: string): void {
    const root = this.figures.get(figureId)?.root;
    if (!root) return;
    const label = new Text({
      text,
      style: { fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold', fill: color, stroke: { color: 0x000000, width: 4 } },
    });
    label.anchor.set(0.5, 1);
    label.position.set(root.x + TILE / 2, root.y + 6);
    this.fxLayer.addChild(label);
    const startY = label.y;
    void tween(800, (t) => {
      label.y = startY - 22 * t;
      label.alpha = 1 - t * t;
    }).then(() => label.destroy());
  }

  private async lunge(attackerId: string, targetId: string): Promise<void> {
    const attacker = this.figures.get(attackerId)?.root;
    const target = this.figures.get(targetId)?.root;
    if (!attacker || !target) return;
    const { x, y } = attacker;
    const dx = Math.sign(target.x - x) * 10;
    const dy = Math.sign(target.y - y) * 10;
    await tween(150, (t) => {
      const swing = Math.sin(t * Math.PI);
      attacker.position.set(x + dx * swing, y + dy * swing);
    });
  }

  /** Animates one event. The caller shows the final scene afterward. */
  async play(event: AnyEvent): Promise<void> {
    switch (event.type) {
      case 'stepped':
        await Promise.all([this.slide('player', [event.to], 110), this.moveCamera(event.to, 110)]);
        break;
      case 'moved':
        await this.slide(event.figureId, event.path, 110);
        break;
      case 'pushed':
        await this.slide(event.figureId, event.path, 70);
        break;
      case 'blinked': {
        const root = this.figures.get(event.figureId)?.root;
        const to = event.path[event.path.length - 1];
        if (root && to) {
          await tween(90, (t) => { root.alpha = 1 - t; });
          root.position.set(to.x * TILE, to.y * TILE);
          await tween(90, (t) => { root.alpha = t; });
        }
        break;
      }
      case 'attacked':
        await this.lunge(event.attackerId, event.targetId);
        this.float(event.targetId, `${event.base} ${modifierLabel(event.modifier)} = ${event.total}`, '#ffffff');
        await wait(260);
        break;
      case 'damaged': {
        const view = this.figures.get(event.figureId);
        if (view) this.drawHp(view, event.hp);
        if (event.source !== 'attack') this.float(event.figureId, `-${event.amount} ${event.source}`, '#ff8a70');
        if (view && event.amount > 0) {
          view.root.tint = 0xff6060;
          await wait(120);
          view.root.tint = 0xffffff;
        }
        break;
      }
      case 'trapSprung':
        this.setTile(event.pos, 'floor');
        break;
      case 'doorOpened':
        this.setTile(event.pos, 'openDoor');
        break;
      case 'conditionApplied':
        this.float(event.figureId, event.condition.toUpperCase(), '#f2d94e');
        await wait(200);
        break;
      case 'healed':
        this.float(event.figureId, `+${event.amount}`, '#5fd35f');
        await wait(200);
        break;
      case 'shielded':
        this.float(event.figureId, `shield ${event.amount}`, '#9fc5ff');
        await wait(200);
        break;
      case 'turnSkipped':
        this.float(event.figureId, 'STUNNED', '#f2d94e');
        await wait(250);
        break;
      case 'defeated': {
        const root = this.figures.get(event.figureId)?.root;
        if (root) await tween(250, (t) => { root.alpha = 1 - t; });
        break;
      }
      default:
        break;
    }
  }
}

