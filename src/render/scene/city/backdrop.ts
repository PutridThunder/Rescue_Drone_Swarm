// What's beyond the mapped area: a water plane at sea level, surrounding land, and open sea on
// any map edge that is mostly water (so inland areas don't get an ocean).

import * as THREE from "three";
import { Terrain } from "../../../shared/terrain";
import type { World } from "../../../types";
import { SCENE } from "../palette";

const EXTENT = 6; // surroundings span this many map widths/heights
const WATER_EDGE_SHARE = 0.3; // an edge with this much water continues as sea

export function buildBackdrop(world: World): THREE.Group {
  const { width: W, height: H } = world.meta;
  const group = new THREE.Group();
  const flat = (w: number, h: number, x: number, y: number, z: number, color: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(x, y, z), new THREE.MeshLambertMaterial({ color }));
    m.receiveShadow = true;
    return m;
  };

  group.add(flat(W, H, W / 2, -0.05, H / 2, SCENE.water)); // sea level under the map
  group.add(flat(W * EXTENT, H * EXTENT, W / 2, -0.6, H / 2, SCENE.ground)); // surrounding land

  const edgeIsWater = (cells: number[]) => cells.filter((i) => world.terrain[i] === Terrain.Water).length / cells.length >= WATER_EDGE_SHARE;
  const row = (y: number) => Array.from({ length: W }, (_, x) => y * W + x);
  const col = (x: number) => Array.from({ length: H }, (_, y) => y * W + x);
  const reach = EXTENT / 2;
  if (edgeIsWater(row(H - 1))) group.add(flat(W * EXTENT, H * reach, W / 2, -0.55, H + (H * reach) / 2 - 0.5, SCENE.water));
  if (edgeIsWater(row(0))) group.add(flat(W * EXTENT, H * reach, W / 2, -0.55, -(H * reach) / 2 + 0.5, SCENE.water));
  if (edgeIsWater(col(0))) group.add(flat(W * reach, H * EXTENT, -(W * reach) / 2 + 0.5, -0.55, H / 2, SCENE.water));
  if (edgeIsWater(col(W - 1))) group.add(flat(W * reach, H * EXTENT, W + (W * reach) / 2 - 0.5, -0.55, H / 2, SCENE.water));
  return group;
}
