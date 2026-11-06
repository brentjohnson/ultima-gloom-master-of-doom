import { expect, test, type Page } from '@playwright/test';
import type { GameController } from '../../src/app/game';

const TILE = 48;

const idle = (page: Page) => expect(page.locator('.layout')).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });

async function clickTile(page: Page, x: number, y: number) {
  await page.getByTestId('arena').locator('canvas').click({ position: { x: x * TILE + 24, y: y * TILE + 24 } });
}

test('with enemies adjacent, clicking yourself keeps you in place for a cleave', async ({ page }) => {
  for (let seed = 1; ; seed++) {
    expect(seed).toBeLessThan(50);
    await page.goto(`/?seed=${seed}`);
    await expect(page.locator('.card')).toHaveCount(5);
    if (await page.locator('[data-card="wide-cleave"]').count()) break;
  }
  await expect(page.locator('.arena canvas')).toBeVisible();
  // Put both skulkers beside the player, at the start tile (1,4).
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameController }).__game;
    const skulkers = g.snapshot.state.figures.filter((f) => f.defId === 'mire-skulker');
    (skulkers[0] as { pos: object }).pos = { x: 1, y: 3 };
    (skulkers[1] as { pos: object }).pos = { x: 2, y: 4 };
  });
  await page.locator('[data-card="wide-cleave"]').click();
  await idle(page);
  await expect(page.getByTestId('prompt')).toContainText('click yourself to stay put');
  await expect(page.getByRole('button', { name: 'Stay put' })).toBeVisible();

  await clickTile(page, 1, 4);
  await idle(page);
  await expect(page.getByTestId('log')).toContainText('You stay put.');
  await expect(page.getByTestId('prompt')).toContainText('click a red target');
  const pos = await page.evaluate(() => (window as unknown as { __game: GameController }).__game.player.pos);
  expect(pos).toEqual({ x: 1, y: 4 });

  const target = await page.evaluate(() => (window as unknown as { __game: GameController }).__game
    .snapshot.state.figures.find((f) => f.defId === 'mire-skulker' && f.hp > 0)?.pos);
  await clickTile(page, (target as { x: number }).x, (target as { y: number }).y);
  await idle(page);
  await expect(page.getByTestId('log')).toContainText('You attack Mire Skulker 1');
  await expect(page.getByTestId('log')).toContainText('You attack Mire Skulker 2');
});

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
    const skip = page.getByRole('button', { name: /^(Stay put|Skip attack|End turn)$/ });
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

test('spell cards spend mana, and the UI blocks them when mana runs out', async ({ page }) => {
  for (let seed = 1; ; seed++) {
    expect(seed).toBeLessThan(100);
    await page.goto(`/?seed=${seed}`);
    await expect(page.locator('.card')).toHaveCount(5);
    if (await page.locator('[data-card="slipstep"]').count()) break;
  }
  await expect(page.locator('.arena canvas')).toBeVisible();
  await expect(page.locator('[data-stat="mana"]')).toContainText('10/10');
  await expect(page.locator('[data-card="slipstep"]')).toContainText('2 mana');
  await expect(page.locator('[data-basic="spark"]')).toContainText('Attack 1, range 3');
  await expect(page.locator('[data-basic="catchBreath"]')).toContainText('+2 stamina, +2 mana');

  await page.locator('[data-card="slipstep"]').click();
  await idle(page);
  await expect(page.locator('[data-stat="mana"]')).toContainText('8/10');
  // The player starts at (1,4); blink three tiles down the open column.
  await clickTile(page, 1, 7);
  await page.waitForTimeout(50);
  await idle(page);
  const pos = await page.evaluate(() => (window as unknown as { __game: GameController }).__game.player.pos);
  expect(pos).toEqual({ x: 1, y: 7 });
  await expect(page.locator('.layout')).toHaveAttribute('data-round', '2');
  await expect(page.locator('[data-stat="mana"]')).toContainText('9/10');
  await page.screenshot({ path: 'test-results/spells.png' });

  // With no mana left, spell cards in hand are disabled while physical cards still work.
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameController }).__game;
    g.snapshot.state.player.mana = 0;
    (g as unknown as { update(patch: object): void }).update({});
  });
  await expect(page.locator('.card.mana:not(:disabled)')).toHaveCount(0);
  await expect(page.locator('.card.stamina:not(:disabled)').first()).toBeVisible();
});
