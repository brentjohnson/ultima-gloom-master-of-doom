/** Mulberry32. The generator's state is a plain number stored in game state. */
export function nextRandom(seed: number): { value: number; rng: number } {
  const rng = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, rng };
}

/** Fisher-Yates shuffle in place. Returns the advanced generator state. */
export function shuffleInPlace<T>(items: T[], seed: number): number {
  let rng = seed;
  for (let i = items.length - 1; i > 0; i--) {
    const r = nextRandom(rng);
    rng = r.rng;
    const j = Math.floor(r.value * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return rng;
}
