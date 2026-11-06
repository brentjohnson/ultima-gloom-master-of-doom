import {
  applyAction, canPlayCard, createCombat, currentEffect, getPlayer, IllegalActionError, legalAttackTargets,
  legalMoveTargets, samePos,
} from '../engine';
import type { Action, CombatState, GameEvent, Pos } from '../engine';
import { testFightSetup } from '../content';
import type { ArenaView } from '../render/arenaView';
import { logLine } from '../ui/text';

const LOG_LIMIT = 200;

export interface GameSnapshot {
  state: CombatState;
  busy: boolean;
  log: string[];
  seed: number;
}

/** Connects the pure engine to the view: one action in, one animated event list out. */
export class GameController {
  private listeners = new Set<() => void>();
  private view: ArenaView | null = null;
  snapshot: GameSnapshot;

  constructor(seed: number) {
    const { state, events } = createCombat(testFightSetup(seed));
    this.snapshot = { state, busy: false, log: this.lines(state, events), seed };
  }

  private lines(state: CombatState, events: GameEvent[]): string[] {
    const nameOf = (id: string) => state.figures.find((f) => f.id === id)?.name ?? id;
    return events.flatMap((e) => logLine(e, nameOf) ?? []);
  }

  attach(view: ArenaView): void {
    this.view = view;
    this.refreshHighlights();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  newFight(seed: number): void {
    const { state, events } = createCombat(testFightSetup(seed));
    this.view?.reset(state);
    this.update({ state, seed, busy: false, log: this.lines(state, events) });
    this.refreshHighlights();
  }

  canPlay(cardId: string): boolean {
    return !this.snapshot.busy && canPlayCard(this.snapshot.state, cardId);
  }

  async dispatch(action: Action): Promise<void> {
    if (this.snapshot.busy) return;
    const previous = this.snapshot.state;
    let result;
    try {
      result = applyAction(previous, action);
    } catch (error) {
      // The UI only offers legal actions, so anything else is a stray click.
      if (error instanceof IllegalActionError) return;
      throw error;
    }
    this.view?.setHighlights([], []);
    this.update({ busy: true });

    const nameOf = (id: string) => result.state.figures.find((f) => f.id === id)?.name ?? id;
    let log = this.snapshot.log;
    for (const event of result.events) {
      const line = logLine(event, nameOf);
      if (line) {
        log = [...log, line].slice(-LOG_LIMIT);
        this.update({ log });
      }
      await this.view?.play(event, result.state);
    }
    this.view?.sync(result.state);
    this.update({ state: result.state, busy: false });
    this.refreshHighlights();
  }

  private refreshHighlights(): void {
    const { state } = this.snapshot;
    const moves = legalMoveTargets(state);
    const stay = moves.length > 0 ? getPlayer(state).pos : null;
    this.view?.setHighlights(moves, legalAttackTargets(state).map((f) => f.pos), stay);
  }

  /** A map click means whatever the current effect is asking for. */
  clickTile(pos: Pos): void {
    const { state, busy } = this.snapshot;
    if (busy) return;
    const effect = currentEffect(state);
    const moving = effect?.kind === 'move' || effect?.kind === 'blink';
    if (moving && samePos(pos, getPlayer(state).pos)) {
      void this.dispatch({ type: 'skipEffect' });
    } else if (moving && legalMoveTargets(state).some((p) => samePos(p, pos))) {
      void this.dispatch({ type: 'move', to: pos });
    } else if (effect?.kind === 'attack') {
      const target = legalAttackTargets(state).find((f) => samePos(f.pos, pos));
      if (target) void this.dispatch({ type: 'attack', targetId: target.id });
    }
  }

  get player() {
    return getPlayer(this.snapshot.state);
  }
}
