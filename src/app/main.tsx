import { render } from 'preact';
import { ArenaView } from '../render/arenaView';
import { App } from '../ui/App';
import { GameController } from './game';
import '../ui/styles.css';

const seedParam = new URLSearchParams(window.location.search).get('seed');
const seed = seedParam !== null && /^-?\d+$/.test(seedParam) ? Number(seedParam) : (Math.random() * 2 ** 31) | 0;
const game = new GameController(seed);

// Hook for the browser smoke test, which needs to know where to click on the canvas.
if (import.meta.env.DEV) (window as unknown as { __game: GameController }).__game = game;

const mountArena = (host: HTMLElement) => {
  void ArenaView.create(host, game.snapshot.state, (pos) => game.clickTile(pos)).then((view) => game.attach(view));
};

render(<App game={game} mountArena={mountArena} />, document.getElementById('root') as HTMLElement);
