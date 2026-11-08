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
    await page.goto(`/?fight=test&seed=${seed}`);
    await expect(page.locator('.card')).toHaveCount(5);
    if (await page.locator('[data-card="wide-cleave"]').count()) break;
  }
  await expect(page.locator('.arena canvas')).toBeVisible();
  // Put both skulkers beside the player, at the start tile (1,4).
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameController }).__game;
    const skulkers = (g.combat as NonNullable<typeof g.combat>).figures.filter((f) => f.defId === 'mire-skulker');
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
  const pos = await page.evaluate(() => (window as unknown as { __game: GameController }).__game.playerPos);
  expect(pos).toEqual({ x: 1, y: 4 });

  const target = await page.evaluate(() => (window as unknown as { __game: GameController }).__game
    .combat!.figures.find((f) => f.defId === 'mire-skulker' && f.hp > 0)?.pos);
  await clickTile(page, (target as { x: number }).x, (target as { y: number }).y);
  await idle(page);
  await expect(page.getByTestId('log')).toContainText('You attack Mire Skulker 1');
  await expect(page.getByTestId('log')).toContainText('You attack Mire Skulker 2');
});

test('a fight can be played with real clicks through to an outcome', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/?fight=test&seed=4');
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
      const state = g.combat as NonNullable<typeof g.combat>;
      const figures = state.figures.filter((f) => f.faction === 'enemy' && f.hp > 0);
      const phase = state.phase;
      const effect = phase.kind === 'playerTurn' ? phase.effects[phase.index] : undefined;
      const player = g.playerPos;
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
        const p = (g.combat as NonNullable<typeof g.combat>).phase;
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
    await page.goto(`/?fight=test&seed=${seed}`);
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
  const pos = await page.evaluate(() => (window as unknown as { __game: GameController }).__game.playerPos);
  expect(pos).toEqual({ x: 1, y: 7 });
  await expect(page.locator('.layout')).toHaveAttribute('data-round', '2');
  await expect(page.locator('[data-stat="mana"]')).toContainText('9/10');
  await page.screenshot({ path: 'test-results/spells.png' });

  // With no mana left, spell cards in hand are disabled while physical cards still work.
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameController }).__game;
    (g.combat as NonNullable<typeof g.combat>).player.mana = 0;
    (g as unknown as { update(patch: object): void }).update({});
  });
  await expect(page.locator('.card.mana:not(:disabled)')).toHaveCount(0);
  await expect(page.locator('.card.stamina:not(:disabled)').first()).toBeVisible();
});

test('walks the world, wins a fight in place, and goes underground', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/?seed=1');
  await expect(page.locator('.arena canvas')).toBeVisible();
  const layout = page.locator('.layout');
  await expect(layout).toHaveAttribute('data-mode', 'explore');
  await expect(layout).toHaveAttribute('data-level', 'Wilds');
  await expect(page.locator('.card')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/world.png' });

  const press = async (key: string, times = 1) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(20);
      await idle(page);
    }
  };
  const pos = () => page.evaluate(() => (window as unknown as { __game: GameController }).__game.playerPos);

  // Trees stop you, and the camera follows along the road.
  await press('ArrowRight', 3);
  expect(await pos()).toEqual({ x: 7, y: 12 });
  await press('w');
  await press('s');
  expect(await pos()).toEqual({ x: 7, y: 12 });

  // Walk the road to the encounter's exit tile, which is safe, then step onto its ground.
  await press('ArrowRight', 14);
  expect(await pos()).toEqual({ x: 21, y: 12 });
  await expect(layout).toHaveAttribute('data-mode', 'explore');
  const staminaBefore = await page.locator('[data-stat="stamina"] .bar-value').textContent();
  expect(staminaBefore).toBe('20/20');
  await press('ArrowRight');
  await expect(layout).toHaveAttribute('data-mode', 'combat');
  await expect(page.locator('.card')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/world-combat.png' });

  // Arrow keys don't walk during a fight.
  await press('ArrowRight');
  expect(await pos()).toEqual({ x: 22, y: 12 });

  // Win: weaken the enemy, then use Spark until it falls.
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameController }).__game;
    for (const f of g.combat!.figures) if (f.faction === 'enemy') f.hp = 1;
  });
  for (let i = 0; i < 40; i++) {
    await idle(page);
    const phase = await layout.getAttribute('data-phase');
    if (phase === 'ended') break;
    if (phase === 'planning') { await page.locator('[data-basic="attack"]').click(); continue; }
    const choice = await page.evaluate(() => {
      const g = (window as unknown as { __game: GameController }).__game;
      const combat = g.combat!;
      const p = combat.phase;
      const effect = p.kind === 'playerTurn' ? p.effects[p.index] : undefined;
      const me = g.playerPos;
      const enemy = combat.figures.find((f) => f.faction === 'enemy' && f.hp > 0);
      if (!enemy) return null;
      return effect?.kind === 'attack' && Math.abs(enemy.pos.x - me.x) + Math.abs(enemy.pos.y - me.y) === 1 ? enemy.pos : null;
    });
    const viewportPos = await page.evaluate((c) => {
      const g = (window as unknown as { __game: GameController }).__game;
      return c ? { c, area: { x: g.combat!.originX, y: g.combat!.originY, w: g.combat!.width, h: g.combat!.height } } : null;
    }, choice);
    if (viewportPos) {
      // The camera centers the fight area in the 14x10 window, clamped to the 40x24 level.
      const { c, area } = viewportPos;
      const left = Math.min(40 - 14, Math.max(0, area.x + area.w / 2 - 0.5 - 6.5));
      const top = Math.min(24 - 10, Math.max(0, area.y + area.h / 2 - 0.5 - 4.5));
      await page.getByTestId('arena').locator('canvas').click({ position: { x: Math.round((c.x - left) * TILE) + 24, y: Math.round((c.y - top) * TILE) + 24 } });
      await page.waitForTimeout(30);
    } else {
      await page.getByRole('button', { name: /^(Stay put|Skip attack|End turn)$/ }).click();
    }
  }
  await expect(layout).toHaveAttribute('data-phase', 'ended');
  await expect(page.getByTestId('outcome')).toContainText('Victory');
  await expect(page.getByTestId('loot').locator('.card')).toHaveCount(1);
  await expect(page.getByTestId('xp')).toHaveText('+4 XP');
  await expect(page.getByTestId('log')).toContainText('You find');
  await page.screenshot({ path: 'test-results/loot.png' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await idle(page);
  await expect(layout).toHaveAttribute('data-mode', 'explore');
  await expect(page.locator('.card')).toHaveCount(0);

  // The drop waits outside the deck until you move it in, and the deck screen pauses walking.
  await page.keyboard.press('c');
  const deckCards = page.getByTestId('deck-cards').locator('.card');
  const spareCards = page.getByTestId('spare-cards').locator('.card');
  await expect(deckCards).toHaveCount(14);
  await expect(spareCards).toHaveCount(1);
  await page.screenshot({ path: 'test-results/deck.png' });
  const standing = await pos();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);
  expect(await pos()).toEqual(standing);
  await spareCards.first().click();
  await expect(deckCards).toHaveCount(15);
  await expect(spareCards).toHaveCount(0);
  for (let i = 15; i > 10; i--) {
    await deckCards.first().click();
    await expect(deckCards).toHaveCount(i - 1);
  }
  await expect(deckCards.first()).toBeDisabled();
  await spareCards.first().click();
  await expect(deckCards).toHaveCount(11);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('deck-screen')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Deck (C)' })).toBeVisible();

  // The cleared ground is safe now, so walking it starts no fight.
  const here = await pos();
  await press('ArrowRight');
  await expect(layout).toHaveAttribute('data-mode', 'explore');
  expect(await pos()).not.toEqual(here);

  // On to the ruin door and down the stairs.
  const walkTo = async (x: number, y: number) => {
    for (let i = 0; i < 80; i++) {
      const p = await pos();
      if (p.x === x && p.y === y) return;
      if (p.y !== 12 && p.x < x) await press('ArrowDown');
      else if (p.x < x) await press('ArrowRight');
      else if (p.x > x) await press('ArrowLeft');
      else if (p.y < y) await press('ArrowDown');
      else await press('ArrowUp');
    }
    throw new Error(`could not reach ${x},${y}`);
  };
  await walkTo(33, 12);
  await walkTo(33, 6);
  await expect(page.getByTestId('log')).toContainText('A door creaks open.');
  await press('ArrowUp');
  await expect(layout).toHaveAttribute('data-level', 'Crypt');
  await expect(page.getByTestId('log')).toContainText('The Sunken Crypt');
  await page.screenshot({ path: 'test-results/crypt.png' });
  expect(errors).toEqual([]);
});

test('earning a level asks for a pool and a basic action upgrade before walking on', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=2');
  await expect(page.locator('.arena canvas')).toBeVisible();
  await expect(page.getByTestId('level')).toHaveText('Level 1, 0/8 XP');

  // Grant the XP directly; earning it in a fight is covered by the engine tests.
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameController }).__game;
    g.snapshot.state.character.xp = 8;
    g.setDeckOpen(false);
  });
  const screen = page.getByTestId('level-up');
  await expect(screen).toBeVisible();
  const pos = () => page.evaluate(() => (window as unknown as { __game: GameController }).__game.playerPos);
  const before = await pos();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);
  expect(await pos()).toEqual(before);

  const confirm = page.getByRole('button', { name: 'Confirm level 2' });
  await expect(confirm).toBeDisabled();
  await page.locator('[data-pool="hp"]').click();
  await expect(confirm).toBeDisabled();
  await screen.getByRole('button', { name: 'range 3 to 4' }).click();
  await page.screenshot({ path: 'test-results/level-up.png' });
  await confirm.click();
  await idle(page);

  await expect(screen).toHaveCount(0);
  await expect(page.getByTestId('level')).toHaveText('Level 2, 8/20 XP');
  await expect(page.locator('[data-stat="hp"] .bar-value')).toHaveText('24/24');
  await expect(page.getByTestId('log')).toContainText('You reach level 2: Health +4, Spark: range 3 to 4.');
  await page.keyboard.press('ArrowRight');
  await idle(page);
  expect(await pos()).not.toEqual(before);
  expect(errors).toEqual([]);
});
