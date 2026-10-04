// Ground mesh: a height field with one vertex per cell corner, coloured by land cover (map data,
// refined by ESA WorldCover when the area has satellite layers).

import * as THREE from "three";
import { Terrain } from "../../../shared/terrain";
import type { World } from "../../../types";
import { LandCover } from "../../../world/earthObservation";
import { SCENE } from "../palette";

const SEA_FLOOR = -0.4; // world units below sea level for all-water corners
const SHORE_DIP = -0.15; // corners that are mostly water dip below the water plane

export function buildTerrainMesh(world: World): THREE.Mesh {
  const { width: W, height: H, cellSizeM } = world.meta;
  const { terrain, elevation } = world;
  const cover = world.eo?.landCover;
  // Satellite land cover finds the green that the map has no park polygon for (yards, ravines).
  const isGreen = (i: number) =>
    terrain[i] === Terrain.Park ||
    (!!cover && terrain[i] === Terrain.Ground && (cover[i] === LandCover.Trees || cover[i] === LandCover.Grassland || cover[i] === LandCover.Shrubland));
  const geo = new THREE.PlaneGeometry(W, H, W, H);
  geo.rotateX(-Math.PI / 2);
  geo.translate(W / 2, 0, H / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const ground = new THREE.Color(SCENE.ground);
  const park = new THREE.Color(SCENE.park);
  const water = new THREE.Color(SCENE.water);
  const c = new THREE.Color();

  for (let v = 0; v < pos.count; v++) {
    const vx = Math.round(pos.getX(v));
    const vz = Math.round(pos.getZ(v));
    // A corner vertex averages the up-to-four cells that touch it.
    let height = 0;
    let cells = 0;
    let waterCells = 0;
    let parkCells = 0;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const cx = vx + dx;
        const cy = vz + dy;
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        const i = cy * W + cx;
        cells++;
        if (terrain[i] === Terrain.Water) waterCells++;
        else height += elevation[i];
        if (isGreen(i)) parkCells++;
      }
    }
    const landCells = cells - waterCells;
    const y = waterCells === cells ? SEA_FLOOR : landCells > 0 ? height / landCells / cellSizeM : 0;
    pos.setY(v, waterCells > 0 && waterCells >= landCells ? Math.min(y, SHORE_DIP) : y);
    c.copy(ground)
      .lerp(park, cells ? parkCells / cells : 0)
      .lerp(water, cells ? waterCells / cells : 0);
    colors.set([c.r, c.g, c.b], v * 3);
  }
  // PlaneGeometry puts v=1 at the north edge; flip so texel row y matches grid row y.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let v = 0; v < uv.count; v++) uv.setY(v, 1 - uv.getY(v));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}
