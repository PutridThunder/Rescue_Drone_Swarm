import { describe, expect, it } from 'vitest';
import { AStar, smoothPath } from './astar';

function grid(w: number, h: number, walls: [number, number][]) {
  const b = new Uint8Array(w * h);
  for (const [x, y] of walls) b[y * w + x] = 1;
  return b;
}

function pathCost(path: number[], w: number) {
  let c = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs((path[i] % w) - (path[i - 1] % w));
    const dy = Math.abs(Math.floor(path[i] / w) - Math.floor(path[i - 1] / w));
    expect(Math.max(dx, dy)).toBe(1);
    c += dx && dy ? Math.SQRT2 : 1;
  }
  return c;
}

describe('AStar', () => {
  it('finds the optimal octile path on an open grid', () => {
    const a = new AStar(20, 20);
    const p = a.find(0, 0, 10, 4, new Uint8Array(400))!;
    expect(p[0]).toBe(0);
    expect(p[p.length - 1]).toBe(4 * 20 + 10);
    expect(pathCost(p, 20)).toBeCloseTo(6 + 4 * Math.SQRT2, 6);
  });

  it('routes around a wall through the gap without touching obstacles', () => {
    const walls: [number, number][] = [];
    for (let y = 0; y < 20; y++) if (y !== 17) walls.push([10, y]);
    const blocked = grid(20, 20, walls);
    const a = new AStar(20, 20);
    const p = a.find(2, 2, 18, 2, blocked)!;
    expect(p).not.toBeNull();
    for (const c of p) expect(blocked[c]).toBe(0);
    expect(p).toContain(17 * 20 + 10);
    // Smoothed waypoints never cross the wall except through the gap.
    const wps = smoothPath(p, blocked, 20);
    expect(wps[wps.length - 1]).toEqual({ x: 18.5, y: 2.5 });
    expect(wps.length).toBeLessThan(p.length);
  });

  it('does not cut corners diagonally between two obstacles', () => {
    const blocked = grid(3, 3, [
      [1, 0],
      [0, 1],
    ]);
    const p = new AStar(3, 3).find(0, 0, 1, 1, blocked);
    expect(p).toBeNull();
  });

  it('returns null when the goal is enclosed or blocked', () => {
    const walls: [number, number][] = [];
    for (let i = 4; i <= 6; i++) walls.push([i, 4], [i, 6], [4, i], [6, i]);
    const blocked = grid(12, 12, walls);
    const a = new AStar(12, 12);
    expect(a.find(0, 0, 5, 5, blocked)).toBeNull();
    expect(a.find(0, 0, 4, 4, blocked)).toBeNull();
  });

  it('avoids high-cost cells when a cheap detour exists', () => {
    const cost = new Float32Array(15 * 15);
    for (let y = 0; y < 12; y++) cost[y * 15 + 7] = 20;
    const p = new AStar(15, 15).find(0, 5, 14, 5, new Uint8Array(225), cost)!;
    expect(p.some((c) => cost[c] > 0)).toBe(false);
  });
});
