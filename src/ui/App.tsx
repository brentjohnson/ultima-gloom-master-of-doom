import { useEffect, useRef, useState } from 'preact/hooks';
import { currentEffect, getPlayer, isOnExit, livingEnemies } from '../engine';
import type { BasicId, CardInstance, CombatState, Figure } from '../engine';
import type { GameController } from '../app/game';
import { describeEffect } from './text';

function useSnapshot(game: GameController) {
  const [, force] = useState(0);
  useEffect(() => game.subscribe(() => force((n) => n + 1)), [game]);
  return game.snapshot;
}

function Bar({ label, value, max, kind }: { label: string; value: number; max: number; kind: string }) {
  return (
    <div class="bar-row" data-stat={kind}>
      <span class="bar-label">{label}</span>
      <div class="bar"><div class={`bar-fill ${kind}`} style={{ width: `${(value / max) * 100}%` }} /></div>
      <span class="bar-value">{value}/{max}</span>
    </div>
  );
}

function CardView({ card, enabled, onPlay }: { card: CardInstance; enabled: boolean; onPlay: () => void }) {
  return (
    <button class={`card ${card.costType}`} disabled={!enabled} onClick={onPlay} data-card={card.id}>
      <span class="card-top">
        <span class="init" title="Initiative: lowest acts first">{card.initiative}</span>
        <span class={`cost ${card.costType}`} title={`${card.costType === 'mana' ? 'Mana' : 'Stamina'} cost`}>
          {card.cost} {card.costType === 'mana' ? 'mana' : 'st'}
        </span>
      </span>
      <span class="card-name">{card.name}</span>
      <span class="card-text">
        {card.effects.map((e, i) => <span key={i}>{describeEffect(e)}</span>)}
      </span>
    </button>
  );
}

const BASIC_ORDER: BasicId[] = ['move', 'attack', 'spark', 'catchBreath'];

function promptFor(state: CombatState, busy: boolean): string {
  if (busy) return 'Resolving...';
  if (state.phase.kind === 'planning') return 'Choose one card or basic action. Enemy plans are hidden until you commit.';
  if (state.phase.kind === 'ended') return '';
  const effect = currentEffect(state);
  if (effect?.kind === 'move' || effect?.kind === 'blink') return `${describeEffect(effect)}: click a green tile, or click yourself to stay put.`;
  if (effect?.kind === 'attack') return `${describeEffect(effect)}: click a red target, or skip the attack.`;
  return 'You are on an exit: flee, or end your turn.';
}

function skipLabel(state: CombatState): string {
  const kind = currentEffect(state)?.kind;
  if (kind === 'move' || kind === 'blink') return 'Stay put';
  if (kind === 'attack') return 'Skip attack';
  return 'End turn';
}

function EnemyRow({ enemy, state }: { enemy: Figure; state: CombatState }) {
  const behavior = state.revealed[enemy.defId];
  return (
    <li class="enemy">
      <div class="enemy-head">
        <strong>{enemy.name}</strong>
        <span>{enemy.hp}/{enemy.maxHp} HP{enemy.shield > 0 ? `, shield ${enemy.shield}` : ''}</span>
      </div>
      {enemy.conditions.length > 0 && <div class="conditions">{enemy.conditions.join(', ')}</div>}
      <div class="intent">
        {behavior
          ? <>[{behavior.initiative}] {behavior.name}: {behavior.effects.map(describeEffect).join('; ')}</>
          : <span class="hidden-intent">Intent hidden</span>}
      </div>
    </li>
  );
}

const OUTCOME_TEXT = { won: 'Victory!', lost: 'You have fallen.', fled: 'You escaped.' } as const;

export function App({ game, mountArena }: { game: GameController; mountArena: (host: HTMLElement) => void }) {
  const { state, busy, log, seed } = useSnapshot(game);
  const arenaHost = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (arenaHost.current) mountArena(arenaHost.current);
  }, [mountArena]);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  const player = getPlayer(state);
  const planning = state.phase.kind === 'planning' && !busy;
  const resolving = state.phase.kind === 'playerTurn' && !busy;
  const ended = state.phase.kind === 'ended' && !busy;
  const modifiers = state.playerModifiers;

  return (
    <div class="layout" data-busy={busy} data-phase={state.phase.kind} data-round={state.round}>
      <div class="main-column">
        <div class="arena-wrap">
          <div ref={arenaHost} class="arena" data-testid="arena" />
          {ended && state.phase.kind === 'ended' && (
            <div class="overlay" data-testid="outcome">
              <h2>{OUTCOME_TEXT[state.phase.outcome]}</h2>
              <p>
                Round {state.round}: {player.hp}/{player.maxHp} HP, {state.player.stamina}/{state.player.maxStamina} stamina, {state.player.mana}/{state.player.maxMana} mana
                {state.phase.outcome === 'won' ? ' (after recovery)' : ''}.
              </p>
              <button class="primary" onClick={() => game.newFight((Math.random() * 2 ** 31) | 0)}>New fight</button>
              <button onClick={() => game.newFight(seed)}>Retry same seed</button>
            </div>
          )}
        </div>
        <div class="turn-bar">
          <p class="prompt" data-testid="prompt">{promptFor(state, busy)}</p>
          {resolving && <button onClick={() => void game.dispatch({ type: 'skipEffect' })}>{skipLabel(state)}</button>}
          {resolving && isOnExit(state) && <button class="primary" onClick={() => void game.dispatch({ type: 'flee' })}>Flee</button>}
        </div>
        <div class="hand">
          {state.player.hand.map((id) => {
            const card = state.cards[id] as CardInstance;
            const isCommitted = state.committed?.cardId === id;
            return (
              <div class={isCommitted ? 'card-slot committed' : 'card-slot'} key={id}>
                <CardView card={card} enabled={planning && game.canPlay(id)} onPlay={() => void game.dispatch({ type: 'playCard', cardId: id })} />
              </div>
            );
          })}
          <div class="basics">
            {BASIC_ORDER.map((id) => {
              const basic = state.basics[id];
              return (
                <button key={id} class="basic" disabled={!planning} data-basic={id} onClick={() => void game.dispatch({ type: 'useBasic', basic: id })}>
                  <strong>{basic.name}</strong>
                  <span>{basic.effects.map(describeEffect).join('; ')}</span>
                  <span>Free, init {basic.initiative}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside class="side">
        <h1>Cardbearer</h1>
        <div class="round">Round {state.round} <span class="seed">seed {seed}</span></div>
        <Bar label="HP" value={player.hp} max={player.maxHp} kind="hp" />
        <Bar label="Stamina" value={state.player.stamina} max={state.player.maxStamina} kind="stamina" />
        <Bar label="Mana" value={state.player.mana} max={state.player.maxMana} kind="mana" />
        <div class="status">
          {player.shield > 0 && <span>Shield {player.shield}</span>}
          {player.conditions.length > 0 && <span class="conditions">{player.conditions.join(', ')}</span>}
        </div>
        <div class="piles">
          Deck {state.player.deck.length}, discard {state.player.discard.length}, modifiers {modifiers.draw.length} left
        </div>

        <p class="rule-note">Only up, down, left and right count as adjacent. A diagonal square is range 2. Each round you regain {state.rules.staminaRegenPerRound} stamina and {state.rules.manaRegenPerRound} mana.</p>

        <h2>Turn order</h2>
        {state.turnOrder.length === 0
          ? <p class="hidden-intent">Set when you commit.</p>
          : (
            <ol class="turn-order">
              {state.turnOrder.map((t, i) => {
                const f = state.figures.find((x) => x.id === t.figureId);
                if (!f || f.hp <= 0) return null;
                return <li key={t.figureId} class={i === state.turnIndex ? 'active' : ''}>[{t.initiative}] {f.name}</li>;
              })}
            </ol>
          )}

        <h2>Enemies</h2>
        <ul class="enemies">
          {livingEnemies(state).map((e) => <EnemyRow key={e.id} enemy={e} state={state} />)}
        </ul>

        <h2>Log</h2>
        <div class="log" data-testid="log">
          {log.map((line, i) => <div key={i} class={line.startsWith('--') ? 'log-round' : ''}>{line}</div>)}
          <div ref={logEnd} />
        </div>
      </aside>
    </div>
  );
}
