import {
  applyGameAction, canPlayCard, currentEffect, currentGrid, getPlayer, IllegalActionError, legalAttackTargets,
  legalMoveTargets, liveEncounters, newGame, PLAYER_ID, resolveCard, samePos,
} from '../engine';
import type { Action, AnyEvent, CardDef, CombatState, Direction, GameAction, GameState, OwnedCard, Pos, WorldDef, WorldRules } from '../engine';
import { newTestFight, TEST_WORLD, WORLD } from '../content';
import type { FigureInfo, Scene, WorldView } from '../render/worldView';
import type { SpriteName } from '../render/sprites';
import { logLine } from '../ui/text';

const LOG_LIMIT = 200;

export interface GameSnapshot {
  state: GameState;
  busy: boolean;
  log: string[];
  seed: number;
  /** The deck builder covers the game while open. */
  deckOpen: boolean;
}

/** Connects the pure engine to the view: one action in, one animated event list out. */
export class GameController {
  private listeners = new Set<() => void>();
  private view: WorldView | null = null;
  private readonly world: WorldDef;
  snapshot: GameSnapshot;

  /** `testFight` opens directly in the combat playtest arena instead of the world. */
  constructor(seed: number, readonly testFight = false) {
    this.world = testFight ? TEST_WORLD : WORLD;
    this.snapshot = this.freshSnapshot(seed);
  }

  private freshSnapshot(seed: number): GameSnapshot {
    if (this.testFight) {
      const { state, events } = newTestFight(seed);
      return { state, busy: false, log: this.lines(state, events), seed, deckOpen: false };
    }
    const state = newGame(this.world, seed);
    return { state, busy: false, log: [`You set out into ${this.levelName(state)}.`], seed, deckOpen: false };
  }

  private levelName(state: GameState): string {
    return this.world.levels[state.levelId]?.name ?? state.levelId;
  }

  get levelTitle(): string {
    return this.levelName(this.snapshot.state);
  }

  private nameOf(state: GameState, id: string): string {
    return state.combat?.figures.find((f) => f.id === id)?.name ?? (id === PLAYER_ID ? 'You' : id);
  }

  private lines(state: GameState, events: AnyEvent[]): string[] {
    return events.flatMap((e) => this.describe(state, e) ?? []);
  }

  private describe(state: GameState, event: AnyEvent): string | null {
    if (event.type === 'levelChanged') return `You enter ${this.levelName(state)}.`;
    if (event.type === 'encounterStarted') return 'Enemies close in!';
    if (event.type === 'doorOpened') return 'A door creaks open.';
    if (event.type === 'stepped' || event.type === 'combatFinished') return null;
    if (event.type === 'cardFound') return `You find ${this.cardTitle(event.card)}.`;
    return logLine(event, (id) => this.nameOf(state, id));
  }

  /** What an owned card does right now, with its rolled properties applied. */
  resolve(card: OwnedCard): CardDef {
    return resolveCard(card, this.world.cards, this.world.affixes);
  }

  private cardTitle(card: OwnedCard): string {
    const { name, affixNames } = this.resolve(card);
    return affixNames?.length ? `${name} (${card.rarity}: ${affixNames.join(', ')})` : name;
  }

  get rules(): WorldRules {
    return this.world.rules;
  }

  setDeckOpen(open: boolean): void {
    const { state, busy } = this.snapshot;
    if (open && (busy || state.mode !== 'explore')) return;
    this.update({ deckOpen: open });
  }

  attach(view: WorldView): void {
    this.view = view;
    this.refreshView();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  get combat(): CombatState | null {
    return this.snapshot.state.combat;
  }

  /** Where the player stands: in the fight if there is one, otherwise on the map. */
  get playerPos(): Pos {
    const { state } = this.snapshot;
    return state.combat ? getPlayer(state.combat).pos : state.pos;
  }

  newGame(seed: number): void {
    this.snapshot = this.freshSnapshot(seed);
    this.listeners.forEach((l) => l());
    this.refreshView();
  }

  canPlay(cardId: string): boolean {
    const { combat } = this;
    return !this.snapshot.busy && !!combat && canPlayCard(combat, cardId);
  }

  dispatchCombat(action: Action): Promise<void> {
    return this.dispatch({ type: 'combat', action });
  }

  step(direction: Direction): void {
    if (this.snapshot.deckOpen) return;
    void this.dispatch({ type: 'step', direction });
  }

  async dispatch(action: GameAction): Promise<void> {
    if (this.snapshot.busy) return;
    const previous = this.snapshot.state;
    let result;
    try {
      result = applyGameAction(previous, action, this.world);
    } catch (error) {
      // Walking into a wall or a stray click isn't an error, just nothing happening.
      if (error instanceof IllegalActionError) return;
      throw error;
    }
    this.view?.setHighlights([], []);
    this.update({ busy: true });

    let log = this.snapshot.log;
    for (const event of result.events) {
      const line = this.describe(result.state, event);
      if (line) {
        log = [...log, line].slice(-LOG_LIMIT);
        this.update({ log });
      }
      // A new fight or level replaces what's on screen before later events can animate.
      if (event.type === 'encounterStarted' || event.type === 'levelChanged') this.view?.show(this.sceneFor(result.state));
      await this.view?.play(event);
    }
    this.update({ state: result.state, busy: false });
    this.refreshView();
  }

  private sceneFor(state: GameState): Scene {
    const level = this.world.levels[state.levelId];
    if (!level) throw new Error(`Unknown level "${state.levelId}"`);
    const figures: FigureInfo[] = [];
    const combat = state.combat;
    const fighting = state.encounterId;
    if (combat) {
      for (const f of combat.figures) figures.push({ ...f, pos: f.pos });
    } else {
      const c = state.character;
      figures.push({ id: PLAYER_ID, name: 'You', defId: 'player', pos: state.pos, hp: c.hp, maxHp: c.maxHp, conditions: [] });
    }
    for (const encounter of liveEncounters(state, this.world)) {
      if (encounter.id === fighting) continue;
      encounter.enemies.forEach((enemy, i) => {
        const def = this.world.enemies.find((e) => e.id === enemy.defId);
        figures.push({
          id: `${encounter.id}:${i}`, name: def?.name ?? enemy.defId, defId: enemy.defId, pos: enemy.pos,
          hp: def?.hp ?? 1, maxHp: def?.hp ?? 1, conditions: [],
        });
      });
    }
    const markers: Scene['markers'] = level.transitions.map((t) => ({ pos: t.pos, sprite: 'stairs' as SpriteName }));
    if (combat) for (const pos of combat.exits) markers.push({ pos, sprite: 'exit' });
    return {
      levelId: state.levelId,
      grid: currentGrid(state, this.world),
      dark: level.dark,
      figures,
      playerPos: combat ? getPlayer(combat).pos : state.pos,
      markers,
      combatArea: combat ? { x: combat.originX, y: combat.originY, width: combat.width, height: combat.height } : null,
    };
  }

  private refreshView(): void {
    const { state } = this.snapshot;
    this.view?.show(this.sceneFor(state));
    const combat = state.combat;
    if (!combat) {
      this.view?.setHighlights([], []);
      return;
    }
    const moves = legalMoveTargets(combat);
    const stay = moves.length > 0 ? getPlayer(combat).pos : null;
    this.view?.setHighlights(moves, legalAttackTargets(combat).map((f) => f.pos), stay);
  }

  /** A map click means whatever the moment is asking for. */
  clickTile(pos: Pos): void {
    const { state, busy } = this.snapshot;
    if (busy) return;
    const combat = state.combat;
    if (!combat) {
      if (state.mode === 'explore') this.stepToward(pos);
      return;
    }
    const effect = currentEffect(combat);
    const moving = effect?.kind === 'move' || effect?.kind === 'blink';
    if (moving && samePos(pos, getPlayer(combat).pos)) {
      void this.dispatchCombat({ type: 'skipEffect' });
    } else if (moving && legalMoveTargets(combat).some((p) => samePos(p, pos))) {
      void this.dispatchCombat({ type: 'move', to: pos });
    } else if (effect?.kind === 'attack') {
      const target = legalAttackTargets(combat).find((f) => samePos(f.pos, pos));
      if (target) void this.dispatchCombat({ type: 'attack', targetId: target.id });
    }
  }

  /** Clicking a tile next to the player walks onto it. */
  private stepToward(pos: Pos): void {
    const { pos: from } = this.snapshot.state;
    const dx = pos.x - from.x;
    const dy = pos.y - from.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return;
    this.step(dx === 1 ? 'east' : dx === -1 ? 'west' : dy === 1 ? 'south' : 'north');
  }
}
