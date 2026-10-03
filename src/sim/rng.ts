/** Mulberry32: small, fast, deterministic PRNG. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = (seed >>> 0) ^ 0x6d2b79f5;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}
