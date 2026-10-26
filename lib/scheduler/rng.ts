/** A tiny, deterministic PRNG (mulberry32) — not cryptographic, just seedable so the scheduler's tests and the UI's "Re-roll" button are both reproducible/distinguishable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, driven by a seeded `rng()` so it's reproducible. Does not mutate `items`. */
export function seededShuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A random 32-bit seed — what the UI's "Randomize"/"Re-roll" buttons generate on each click. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
