import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { samePos, tileAt } from '../engine';
import type { CombatState, Figure, GameEvent, Modifier, Pos } from '../engine';
import { buildTextures, TILE_PIXELS, type SpriteName } from './sprites';

const SCALE = 3;
const TILE = TILE_PIXELS * SCALE;

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

interface FigureView { root: Container; hpBar: Graphics; pips: Graphics }

/** Draws a combat state and plays its events. Holds no rules of its own. */
export class ArenaView {
  private readonly textures = buildTextures();
  private readonly tileLayer = new Container();
  private readonly highlightLayer = new Graphics();
  private readonly figureLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly figures = new Map<string, FigureView>();
  private tiles = new Map<string, Sprite>();
  private onTile: (pos: Pos) => void = () => {};

  private constructor(private readonly app: Application) {
    app.stage.addChild(this.tileLayer, this.highlightLayer, this.figureLayer, this.fxLayer);
    app.stage.eventMode = 'static';
    app.stage.on('pointertap', (e) => {
      this.onTile({ x: Math.floor(e.global.x / TILE), y: Math.floor(e.global.y / TILE) });
    });
  }

  static async create(host: HTMLElement, state: CombatState, onTile: (pos: Pos) => void): Promise<ArenaView> {
    const app = new Application();
    await app.init({
      width: state.width * TILE,
      height: state.height * TILE,
      background: '#14161c',
      antialias: false,
      preference: 'webgl',
    });
    app.stage.hitArea = app.screen;
    host.replaceChildren(app.canvas);
    const view = new ArenaView(app);
    view.onTile = onTile;
    view.reset(state);
    return view;
  }

  /** Rebuilds everything from a fresh state, for a new fight. */
  reset(state: CombatState): void {
    this.tileLayer.removeChildren().forEach((child) => child.destroy());
    this.figureLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    // Floating labels are destroyed by their own tweens, which may still be running.
    this.fxLayer.removeChildren();
    this.figures.clear();
    this.tiles.clear();
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const floor = new Sprite(this.textures.floor);
        floor.scale.set(SCALE);
        floor.position.set(x * TILE, y * TILE);
        this.tileLayer.addChild(floor);
        const name = overlayFor(state, { x, y });
        if (name) {
          const sprite = new Sprite(this.textures[name]);
          sprite.scale.set(SCALE);
          sprite.position.set(x * TILE, y * TILE);
          this.tileLayer.addChild(sprite);
          this.tiles.set(`${x},${y}`, sprite);
        }
      }
    }
    for (const figure of state.figures) this.addFigure(figure);
    this.sync(state);
  }

  private addFigure(figure: Figure): void {
    const root = new Container();
    const sprite = new Sprite(this.textures[figure.defId === 'player' ? 'player' : (figure.defId as SpriteName)]);
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
    this.figures.set(figure.id, { root, hpBar, pips });
  }

  /** Snaps the display to exactly match `state`. */
  sync(state: CombatState): void {
    for (const figure of state.figures) {
      const view = this.figures.get(figure.id);
      if (!view) continue;
      view.root.visible = figure.hp > 0;
      view.root.alpha = 1;
      view.root.position.set(figure.pos.x * TILE, figure.pos.y * TILE);
      this.drawHp(view, figure.hp, figure.maxHp);
      view.pips.clear();
      figure.conditions.forEach((c, i) => view.pips.rect(2 + i * 8, 2, 6, 6).fill(CONDITION_COLORS[c]));
    }
    for (const [key, sprite] of this.tiles) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      sprite.visible = overlayFor(state, { x, y }) !== null;
    }
  }

  private drawHp(view: FigureView, hp: number, maxHp: number): void {
    view.hpBar.clear();
    view.hpBar.rect(2, TILE - 6, TILE - 4, 5).fill(0x000000);
    view.hpBar.rect(3, TILE - 5, Math.max(0, (TILE - 6) * (hp / maxHp)), 3).fill(hp / maxHp > 0.4 ? 0x5fd35f : 0xe0403f);
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

  /** Animates one event. The caller syncs the final state afterward. */
  async play(event: GameEvent, state: CombatState): Promise<void> {
    switch (event.type) {
      case 'moved':
        await this.slide(event.figureId, event.path, 110);
        break;
      case 'pushed':
        await this.slide(event.figureId, event.path, 70);
        break;
      case 'attacked':
        await this.lunge(event.attackerId, event.targetId);
        this.float(event.targetId, `${event.base} ${modifierLabel(event.modifier)} = ${event.total}`, '#ffffff');
        await wait(260);
        break;
      case 'damaged': {
        const view = this.figures.get(event.figureId);
        const figure = state.figures.find((f) => f.id === event.figureId);
        if (view && figure) this.drawHp(view, event.hp, figure.maxHp);
        if (event.source !== 'attack') this.float(event.figureId, `-${event.amount} ${event.source}`, '#ff8a70');
        if (view && event.amount > 0) {
          view.root.tint = 0xff6060;
          await wait(120);
          view.root.tint = 0xffffff;
        }
        break;
      }
      case 'trapSprung':
        this.tiles.get(`${event.pos.x},${event.pos.y}`)?.destroy();
        this.tiles.delete(`${event.pos.x},${event.pos.y}`);
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

function overlayFor(state: CombatState, p: Pos): SpriteName | null {
  if (state.exits.some((e) => samePos(e, p))) return 'exit';
  const tile = tileAt(state, p);
  return tile === 'floor' ? null : tile;
}
