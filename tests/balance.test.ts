import { describe, expect, it } from 'vitest';
import { createCombat } from '../src/engine';
import { testFightSetup } from '../src/content';
import { playOut } from './helpers';

describe('balance bot (rough check, not a substitute for playing)', () => {
  it('finds the test fight winnable but not free', () => {
    const fights = 500;
    let wins = 0;
    let rounds = 0;
    let staminaLeft = 0;
    let hpLeft = 0;
    for (let seed = 0; seed < fights; seed++) {
      const end = playOut(createCombat(testFightSetup(seed * 7919 + 1)).state).state;
      const won = end.phase.kind === 'ended' && end.phase.outcome === 'won';
      if (won) {
        wins += 1;
        staminaLeft += end.player.stamina;
        hpLeft += end.figures[0]?.hp ?? 0;
      }
      rounds += end.round;
    }
    const rate = wins / fights;
    console.log(`greedy bot: ${(rate * 100).toFixed(0)}% wins, ${(rounds / fights).toFixed(1)} rounds, `
      + `on a win ${(hpLeft / Math.max(1, wins)).toFixed(1)} HP and ${(staminaLeft / Math.max(1, wins)).toFixed(1)} stamina left`);
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.95);
  }, 60_000);
});
