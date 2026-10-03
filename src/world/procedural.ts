import { Terrain, type World } from '../types';

/** Multi-source BFS from all water cells; distance in cells (4-connected). Writes world.coastDistance. */
export function computeCoastDistance(world: World): Float32Array {
  const { width, height } = world.meta;
  const n = width * height;
  const dist = new Float32Array(n).fill(Infinity);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (world.terrain[i] === Terrain.Water) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  if (tail === 0) dist.fill(width + height);
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const d = dist[i] + 1;
    if (x > 0 && dist[i - 1] > d) { dist[i - 1] = d; queue[tail++] = i - 1; }
    if (x < width - 1 && dist[i + 1] > d) { dist[i + 1] = d; queue[tail++] = i + 1; }
    if (i >= width && dist[i - width] > d) { dist[i - width] = d; queue[tail++] = i - width; }
    if (i + width < n && dist[i + width] > d) { dist[i + width] = d; queue[tail++] = i + width; }
  }
  world.coastDistance = dist;
  return dist;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth value noise for coastline wobble and terrain. */
function makeNoise(rand: () => number) {
  const size = 64;
  const table = new Float32Array(size * size).map(() => rand());
  const at = (x: number, y: number) => table[((y & (size - 1)) * size) + (x & (size - 1))];
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** A plausible coastal city: sea to the south, slopes rising north, road grid, blocks, parks. */
export function generateProceduralWorld(seed = 1, width = 160, height = 120): World {
  const rand = mulberry32(seed);
  const noise = makeNoise(rand);
  const n = width * height;
  const terrain = new Uint8Array(n).fill(Terrain.Ground);
  const elevation = new Float32Array(n);
  const buildingHeight = new Float32Array(n);
  const population = new Float32Array(n);

  const coastY = (x: number) => height * 0.8 + (noise(x * 0.06, 3.3) - 0.5) * height * 0.12 + Math.sin(x * 0.05) * 3;
  const parkCentres = Array.from({ length: 5 }, () => ({
    x: rand() * width,
    y: rand() * height * 0.6,
    r: 3 + rand() * 6,
  }));
  const blockW = 7, blockH = 6;
  const avenueEvery = 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const cy = coastY(x);
      if (y > cy) {
        terrain[i] = Terrain.Water;
        continue;
      }
      const inland = (cy - y) / cy; // 0 at coast, 1 at north edge
      const elev = 0.5 + Math.pow(inland, 1.6) * 380 + noise(x * 0.08, y * 0.08) * 25 * inland;
      elevation[i] = elev;
      const forest = inland > 0.72 + (noise(x * 0.1, 9.1) - 0.5) * 0.15;
      const nearPark = parkCentres.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r);
      const waterfront = cy - y < 2.5;
      if (forest || nearPark || waterfront) {
        terrain[i] = Terrain.Park;
        population[i] = 0.03;
        continue;
      }
      const roadX = x % blockW === 0;
      const roadY = y % blockH === 0;
      if (roadX || roadY) {
        terrain[i] = Terrain.Road;
        continue;
      }
      if (rand() < 0.62) {
        terrain[i] = Terrain.Building;
        const downtown = Math.max(0, 1 - Math.hypot(x - width / 2, y - cy + 12) / 30);
        const isTower = rand() < downtown * 0.6;
        const h = isTower ? 25 + rand() * 60 : 6 + rand() * 6 + downtown * 10;
        buildingHeight[i] = h;
        const commercial = (Math.floor(x / blockW) % avenueEvery === 0) && rand() < 0.7;
        population[i] = commercial ? 0 : (900 * 0.45 * Math.max(1, Math.round(h / 3.2))) / 45;
      }
    }
  }

  // Base: centre-south, nearest park/ground cell to the waterfront at mid-width.
  const bx0 = Math.floor(width / 2);
  const by0 = Math.floor(coastY(bx0)) - 2;
  let base = { x: bx0, y: by0 };
  let best = Infinity;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const t = terrain[y * width + x];
      if (t !== Terrain.Park && t !== Terrain.Ground) continue;
      const d = (x - bx0) ** 2 + (y - by0) ** 2;
      if (d < best) { best = d; base = { x, y }; }
    }

  const world: World = {
    meta: { name: `Procedural Harbour City #${seed}`, bbox: [0, 0, 0, 0], cellSizeM: 30, width, height, source: 'procedural' },
    terrain,
    elevation,
    buildingHeight,
    population,
    coastDistance: new Float32Array(n),
    base,
  };
  computeCoastDistance(world);
  return world;
}
