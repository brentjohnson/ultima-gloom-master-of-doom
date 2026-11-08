import { useEffect, useRef, useState } from 'preact/hooks';
import { currentEffect, getPlayer, isOnExit, livingEnemies } from '../engine';
import type { BasicId, CardDef, CardInstance, CombatState, Figure, GameState, OwnedCard } from '../engine';
import { RARITY_ORDER } from '../engine';
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

function CardFace({ card }: { card: CardDef }) {
  const rarity = card.rarity ?? 'plain';
  return (
    <>
      <span class="card-top">
        <span class="init" title="Initiative: lowest acts first">{card.initiative}</span>
        <span class={`cost ${card.costType}`} title={`${card.costType === 'mana' ? 'Mana' : 'Stamina'} cost`}>
          {card.cost} {card.costType === 'mana' ? 'mana' : 'st'}
        </span>
      </span>
      <span class={`card-name ${rarity}`}>{card.name}</span>
      {rarity !== 'plain' && <span class={`card-affixes ${rarity}`}>{rarity}: {card.affixNames?.join(', ')}</span>}
      <span class="card-text">
        {card.effects.map((e, i) => <span key={i}>{describeEffect(e)}</span>)}
      </span>
    </>
  );
}

function CardView({ card, enabled, onPlay, title }: { card: CardDef; enabled: boolean; onPlay: () => void; title?: string }) {
  return (
    <button class={`card ${card.costType}`} disabled={!enabled} onClick={onPlay} data-card={card.id} title={title}>
      <CardFace card={card} />
    </button>
  );
}

function LootList({ game, loot }: { game: GameController; loot: OwnedCard[] }) {
  if (loot.length === 0) return null;
  return (
    <div class="loot" data-testid="loot">
      {loot.map((owned) => <div class={`card ${game.resolve(owned).costType}`} key={owned.uid}><CardFace card={game.resolve(owned)} /></div>)}
    </div>
  );
}

/** Best cards first, then by name, so copies of a card sit together. */
function sortCards(cards: OwnedCard[], game: GameController): { owned: OwnedCard; card: CardDef }[] {
  return cards
    .map((owned) => ({ owned, card: game.resolve(owned) }))
    .sort((a, b) => RARITY_ORDER.indexOf(b.owned.rarity) - RARITY_ORDER.indexOf(a.owned.rarity) || a.card.name.localeCompare(b.card.name));
}

function DeckScreen({ game, state }: { game: GameController; state: GameState }) {
  const { collection, deck } = state.character;
  const { minDeck, maxDeck } = game.rules;
  const inDeck = sortCards(collection.filter((c) => deck.includes(c.uid)), game);
  const spare = sortCards(collection.filter((c) => !deck.includes(c.uid)), game);
  const atMin = deck.length <= minDeck;
  const atMax = deck.length >= maxDeck;
  return (
    <div class="deck-screen" data-testid="deck-screen">
      <div class="deck-head">
        <h1>Deck and collection</h1>
        <span class="deck-rule">A deck holds {minDeck} to {maxDeck} cards. Click a card to move it.</span>
        <button class="primary" onClick={() => game.setDeckOpen(false)}>Close (Esc)</button>
      </div>
      <h2>In your deck: {deck.length} of {maxDeck}{atMin ? ' (at the minimum, add a card to take one out)' : ''}</h2>
      <div class="deck-grid" data-testid="deck-cards">
        {inDeck.map(({ owned, card }) => (
          <CardView
            key={owned.uid} card={card} enabled={!atMin} title={atMin ? `A deck needs at least ${minDeck} cards` : 'Take out of the deck'}
            onPlay={() => void game.dispatch({ type: 'removeFromDeck', uid: owned.uid })}
          />
        ))}
      </div>
      <h2>Not in your deck: {spare.length}{atMax && spare.length > 0 ? ' (the deck is full, take a card out first)' : ''}</h2>
      {spare.length === 0 && <p class="hidden-intent">Cards you find or take out of your deck wait here.</p>}
      <div class="deck-grid" data-testid="spare-cards">
        {spare.map(({ owned, card }) => (
          <CardView
            key={owned.uid} card={card} enabled={!atMax} title={atMax ? `A deck holds at most ${maxDeck} cards` : 'Add to the deck'}
            onPlay={() => void game.dispatch({ type: 'addToDeck', uid: owned.uid })}
          />
        ))}
      </div>
    </div>
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

function OutcomeOverlay({ game, combat, seed, loot }: { game: GameController; combat: CombatState; seed: number; loot: OwnedCard[] }) {
  if (combat.phase.kind !== 'ended') return null;
  const { outcome } = combat.phase;
  const player = getPlayer(combat);
  const finish = () => void game.dispatch({ type: 'finishCombat' });
  return (
    <div class="overlay" data-testid="outcome">
      <h2>{OUTCOME_TEXT[outcome]}</h2>
      <p>
        Round {combat.round}: {player.hp}/{player.maxHp} HP, {combat.player.stamina}/{combat.player.maxStamina} stamina,
        {' '}{combat.player.mana}/{combat.player.maxMana} mana{outcome === 'won' ? ' (after recovery)' : ''}.
      </p>
      <LootList game={game} loot={loot} />
      {game.testFight
        ? (
          <>
            <button class="primary" onClick={() => game.newGame((Math.random() * 2 ** 31) | 0)}>New fight</button>
            <button onClick={() => game.newGame(seed)}>Retry same seed</button>
          </>
        )
        : <button class="primary" onClick={finish}>Continue</button>}
    </div>
  );
}

function CombatPanel({ game, combat, busy }: { game: GameController; combat: CombatState; busy: boolean }) {
  const planning = combat.phase.kind === 'planning' && !busy;
  const resolving = combat.phase.kind === 'playerTurn' && !busy;
  return (
    <>
      <div class="turn-bar">
        <p class="prompt" data-testid="prompt">{promptFor(combat, busy)}</p>
        {resolving && <button onClick={() => void game.dispatchCombat({ type: 'skipEffect' })}>{skipLabel(combat)}</button>}
        {resolving && isOnExit(combat) && <button class="primary" onClick={() => void game.dispatchCombat({ type: 'flee' })}>Flee</button>}
      </div>
      <div class="hand">
        {combat.player.hand.map((id) => {
          const card = combat.cards[id] as CardInstance;
          const isCommitted = combat.committed?.cardId === id;
          return (
            <div class={isCommitted ? 'card-slot committed' : 'card-slot'} key={id}>
              <CardView card={card} enabled={planning && game.canPlay(id)} onPlay={() => void game.dispatchCombat({ type: 'playCard', cardId: id })} />
            </div>
          );
        })}
        <div class="basics">
          {BASIC_ORDER.map((id) => {
            const basic = combat.basics[id];
            return (
              <button key={id} class="basic" disabled={!planning} data-basic={id} onClick={() => void game.dispatchCombat({ type: 'useBasic', basic: id })}>
                <strong>{basic.name}</strong>
                <span>{basic.effects.map(describeEffect).join('; ')}</span>
                <span>Free, init {basic.initiative}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function CombatSidebar({ combat }: { combat: CombatState }) {
  const player = getPlayer(combat);
  return (
    <>
      <div class="status">
        {player.shield > 0 && <span>Shield {player.shield}</span>}
        {player.conditions.length > 0 && <span class="conditions">{player.conditions.join(', ')}</span>}
      </div>
      <div class="piles">
        Deck {combat.player.deck.length}, discard {combat.player.discard.length}, modifiers {combat.playerModifiers.draw.length} left
      </div>
      <p class="rule-note">Only up, down, left and right count as adjacent. A diagonal square is range 2. Each round you regain {combat.rules.staminaRegenPerRound} stamina and {combat.rules.manaRegenPerRound} mana.</p>

      <h2>Turn order</h2>
      {combat.turnOrder.length === 0
        ? <p class="hidden-intent">Set when you commit.</p>
        : (
          <ol class="turn-order">
            {combat.turnOrder.map((t, i) => {
              const f = combat.figures.find((x) => x.id === t.figureId);
              if (!f || f.hp <= 0) return null;
              return <li key={t.figureId} class={i === combat.turnIndex ? 'active' : ''}>[{t.initiative}] {f.name}</li>;
            })}
          </ol>
        )}

      <h2>Enemies</h2>
      <ul class="enemies">
        {livingEnemies(combat).map((e) => <EnemyRow key={e.id} enemy={e} state={combat} />)}
      </ul>
    </>
  );
}

export function App({ game, mountArena }: { game: GameController; mountArena: (host: HTMLElement) => void }) {
  const { state, busy, log, seed, deckOpen } = useSnapshot(game);
  const arenaHost = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (arenaHost.current) mountArena(arenaHost.current);
  }, [mountArena]);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [log.length]);

  const combat = state.combat;
  const c = state.character;
  // During a fight the fight's own numbers are the live ones.
  const hp = combat ? getPlayer(combat).hp : c.hp;
  const stamina = combat ? combat.player.stamina : c.stamina;
  const mana = combat ? combat.player.mana : c.mana;
  const phase = combat ? combat.phase.kind : state.mode;

  return (
    <div class="layout" data-busy={busy} data-mode={state.mode} data-phase={phase} data-round={combat?.round ?? 0} data-level={state.levelId}>
      <div class="main-column">
        <div class="arena-wrap">
          <div ref={arenaHost} class="arena" data-testid="arena" />
          {combat && !busy && <OutcomeOverlay game={game} combat={combat} seed={seed} loot={state.pendingLoot} />}
          {state.mode === 'dead' && !busy && (
            <div class="overlay" data-testid="dead">
              <h2>You have fallen.</h2>
              <p>The world stays as it was. You don't.</p>
              <button class="primary" onClick={() => game.newGame((Math.random() * 2 ** 31) | 0)}>New game</button>
            </div>
          )}
        </div>
        {combat
          ? <CombatPanel game={game} combat={combat} busy={busy} />
          : (
            <div class="turn-bar">
              <p class="prompt" data-testid="prompt">
                {state.mode === 'explore' ? 'Arrow keys or WASD to walk, or click a tile next to you. Enemies attack when you enter their ground.' : ''}
              </p>
              {state.mode === 'explore' && <button disabled={busy} onClick={() => game.setDeckOpen(true)}>Deck (C)</button>}
            </div>
          )}
      </div>

      <aside class="side">
        <h1>Cardbearer</h1>
        <div class="round">
          {combat ? `Round ${combat.round}` : game.levelTitle} <span class="seed">seed {seed}</span>
        </div>
        <Bar label="HP" value={hp} max={c.maxHp} kind="hp" />
        <Bar label="Stamina" value={stamina} max={c.maxStamina} kind="stamina" />
        <Bar label="Mana" value={mana} max={c.maxMana} kind="mana" />
        {combat
          ? <CombatSidebar combat={combat} />
          : <div class="piles">Deck {c.deck.length} of {c.collection.length} cards owned. Walking slowly restores stamina and mana.</div>}

        <h2>Log</h2>
        <div class="log" data-testid="log">
          {log.map((line, i) => <div key={i} class={line.startsWith('--') ? 'log-round' : ''}>{line}</div>)}
          <div ref={logEnd} />
        </div>
      </aside>
      {deckOpen && <DeckScreen game={game} state={state} />}
    </div>
  );
}
