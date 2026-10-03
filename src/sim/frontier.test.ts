import { describe, expect, it } from 'vitest';
import { updateFrontier } from './frontier';
import { Knowledge } from './knowledge';

describe('frontier', () => {
  it('marks the ring of unsearched land around a searched block, but not water', () => {
    const w = 12;
    const h = 10;
    const k = new Knowledge(w * h);
    k.known.fill(1);
    const terrain = new Uint8Array(w * h).fill(1);
    for (let x = 0; x < w; x++) terrain[9 * w + x] = 0; // sea row
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) k.searched[y * w + x] = 1;
    for (let x = 0; x < w; x++) k.searched[8 * w + x] = 0.95; // searched strip next to the sea
    const count = updateFrontier(k, terrain, w, h);

    const f = (x: number, y: number) => k.frontier[y * w + x];
    expect(f(4, 4)).toBe(0); // searched interior
    expect(f(2, 4)).toBe(1);
    expect(f(6, 4)).toBe(1);
    expect(f(4, 2)).toBe(1);
    expect(f(4, 6)).toBe(1);
    expect(f(2, 2)).toBe(0); // diagonal only: 4-neighbour frontier
    expect(f(0, 0)).toBe(0); // far away
    expect(f(5, 7)).toBe(1); // borders the searched strip
    expect(f(5, 9)).toBe(0); // water is never frontier
    expect(count).toBe(12 + w);
    expect(k.drain().length).toBe(count);
  });

  it('treats the known/unknown boundary as frontier when geography is unknown', () => {
    const w = 8;
    const k = new Knowledge(w * w);
    const terrain = new Uint8Array(w * w).fill(1);
    k.known[3 * w + 3] = 1;
    updateFrontier(k, terrain, w, w);
    expect(k.frontier[3 * w + 3]).toBe(1);
    expect(k.frontier[3 * w + 4]).toBe(1);
    expect(k.frontier[0]).toBe(0);
  });
});
