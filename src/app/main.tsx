import { render } from 'preact';
import type { Direction } from '../engine';
import { WorldView } from '../render/worldView';
import { App } from '../ui/App';
import { GameController } from './game';
import '../ui/styles.css';

const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null && /^-?\d+$/.test(seedParam) ? Number(seedParam) : (Math.random() * 2 ** 31) | 0;
const game = new GameController(seed, params.get('fight') === 'test');

// Hook for the browser smoke tests, which need to know where to click on the canvas.
if (import.meta.env.DEV) (window as unknown as { __game: GameController }).__game = game;

const KEYS: Record<string, Direction> = {
  ArrowUp: 'north', ArrowRight: 'east', ArrowDown: 'south', ArrowLeft: 'west',
  w: 'north', d: 'east', s: 'south', a: 'west',
};

window.addEventListener('keydown', (e) => {
  const direction = KEYS[e.key];
  if (!direction || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  if (game.snapshot.state.mode === 'explore') game.step(direction);
});

const mountArena = (host: HTMLElement) => {
  void WorldView.create(host, (pos) => game.clickTile(pos)).then((view) => game.attach(view));
};

render(<App game={game} mountArena={mountArena} />, document.getElementById('root') as HTMLElement);
