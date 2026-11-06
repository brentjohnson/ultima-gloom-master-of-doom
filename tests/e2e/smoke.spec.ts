import { expect, test, type Page } from '@playwright/test';
import type { GameController } from '../../src/app/game';

const TILE = 48;

const idle = (page: Page) => expect(page.locator('.layout')).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });

async function clickTile(page: Page, x: number, y: number) {
  await page.getByTestId('arena').locator('canvas').click({ position: { x: x * TILE + 24, y: y * TILE + 24 } });
}

test('a fight can be played with real clicks through to an outcome', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/?seed=4');
  await expect(page.locator('.arena canvas')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(5);
  await expect(page.locator('.hidden-intent').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/planning.png' });

  // Commit a card and resolve it by clicking the canvas, then watch enemies reveal.
  await page.locator('[data-card="hasty-step"], [data-card="shoulder-charge"], [data-card="wide-cleave"], [data-card="hamstring"], [data-card="heavy-swing"]').first().click();
  await idle(page);
  await expect(page.locator('.intent').first()).not.toContainText('Intent hidden');
  await page.screenshot({ path: 'test-results/resolving.png' });

  // Play on with the first legal choice until the fight ends.
  for (let i = 0; i < 400; i++) {
    await idle(page);
    const phase = await page.locator('.layout').getAttribute('data-phase');
    if (phase === 'ended') break;
    if (phase === 'planning') {
      const playable = page.locator('.card:not(:disabled)');
      if (await playable.count()) await playable.first().click();
      else await page.locator('[data-basic="catchBreath"]').click();
      continue;
    }
    const choice = await page.evaluate(() => {
      const g = (window as unknown as { __game: GameController }).__game;
      const state = g.snapshot.state;
      const figures = state.figures.filter((f) => f.faction === 'enemy' && f.hp > 0);
      const phase = state.phase;
      const effect = phase.kind === 'playerTurn' ? phase.effects[phase.index] : undefined;
      const player = g.player.pos;
      if (effect?.kind === 'attack') {
        const inRange = figures.filter((f) => Math.abs(f.pos.x - player.x) + Math.abs(f.pos.y - player.y) <= (effect.allAdjacent ? 1 : effect.range));
        return inRange[0]?.pos ?? null;
      }
      return null;
    });
    const skip = page.getByRole('button', { name: /^(Skip|End turn)$/ });
    if (choice) {
      await clickTile(page, choice.x, choice.y);
      await page.waitForTimeout(50);
      await idle(page);
      const stuck = await page.evaluate((c) => {
        const g = (window as unknown as { __game: GameController }).__game;
        const p = g.snapshot.state.phase;
        return p.kind === 'playerTurn' && p.effects[p.index]?.kind === 'attack' && !!c;
      }, choice);
      if (stuck) await skip.click();
    } else {
      await skip.click();
    }
  }
  await expect(page.locator('.layout')).toHaveAttribute('data-phase', 'ended');
  await expect(page.getByTestId('outcome')).toBeVisible();
  await page.screenshot({ path: 'test-results/ended.png' });

  await page.getByRole('button', { name: 'New fight' }).click();
  await expect(page.getByTestId('outcome')).toBeHidden();
  await expect(page.locator('.layout')).toHaveAttribute('data-round', '1');
  expect(errors).toEqual([]);
});
