import type { World } from '../types';

/**
 * Synthetic coastal town for tests: sea along the south, a hill to the north,
 * a road grid, residential blocks, one cluster of tall towers and population blobs.
 */
export function makeTestWorld(width = 60, height = 50): World {
  const n = width * height;
  const terrain = new Uint8Array(n);
  const elevation = new Float32Array(n);
  const buildingHeight = new Float32Array(n);
  const population = new Float32Array(n);
  const seaY = Math.floor(height * 0.84);
  const blobs = [
    { x: width * 0.25, y: height * 0.74, r: width * 0.1, p: 40 },
    { x: width * 0.75, y: height * 0.5, r: width * 0.12, p: 30 },
    { x: width * 0.5, y: height * 0.3, r: width * 0.08, p: 15 },
  ];
  const tx0 = Math.floor(width * 0.55);
  const ty0 = Math.floor(height * 0.6);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (y >= seaY) continue; // water, elevation 0
      const hill = 80 * Math.exp(-((x - width / 2) ** 2 + (y - height * 0.12) ** 2) / (2 * (width / 6) ** 2));
      elevation[i] = (seaY - y) * 1.2 + hill;
      if (hill > 30) terrain[i] = 3;
      else if (x % 8 === 0 || y % 8 === 0) terrain[i] = 2;
      else if ((x + y) % 3 === 0) {
        terrain[i] = 4;
        buildingHeight[i] = 10;
      } else terrain[i] = 1;
      if (x >= tx0 && x < tx0 + 4 && y >= ty0 && y < ty0 + 4) {
        terrain[i] = 4;
        buildingHeight[i] = 80;
      }
      if (terrain[i] !== 3) {
        for (const b of blobs) population[i] += b.p * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r ** 2));
      }
    }
  }
  const world: World = {
    meta: { name: 'test', bbox: [0, 0, 1, 1], cellSizeM: 30, width, height, source: 'procedural' },
    terrain,
    elevation,
    buildingHeight,
    population,
    coastDistance: new Float32Array(n),
    base: { x: Math.floor(width / 2), y: Math.floor(height * 0.45) },
  };
  world.coastDistance = coastDistance(world);
  return world;
}

/** Multi-source BFS distance (cells, 8-connected) to the nearest water cell. */
export function coastDistance(world: World): Float32Array {
  const { width, height } = world.meta;
  const n = width * height;
  const dist = new Float32Array(n).fill(Infinity);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (world.terrain[i] === 0) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (dist[j] > dist[i] + 1) {
          dist[j] = dist[i] + 1;
          queue[tail++] = j;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(dist[i])) dist[i] = width + height;
  return dist;
}
