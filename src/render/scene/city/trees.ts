// Low-poly trees scattered over park cells (deterministic), like a model-railway diorama.

import * as THREE from "three";
import { Terrain } from "../../../shared/terrain";
import type { World } from "../../../types";
import { SCENE } from "../palette";
import { QUALITY } from "../quality";
import type { HeightField } from "./HeightField";

const MAX_TREES = 2500; // dense forests are thinned to keep phones smooth
const SEED = 1234567;

export function buildTrees(world: World, heights: HeightField): THREE.InstancedMesh {
  const { width: W, height: H } = world.meta;
  const { terrain, buildingHeight } = world;
  let seed = SEED;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  let spots: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (terrain[i] !== Terrain.Park || buildingHeight[i] > 0 || rand() > QUALITY.treeDensity) continue;
      spots.push([x + 0.2 + rand() * 0.6, y + 0.2 + rand() * 0.6]);
    }
  }
  if (spots.length > MAX_TREES) {
    const keep = MAX_TREES / spots.length;
    spots = spots.filter(() => rand() < keep);
  }

  const geo = new THREE.IcosahedronGeometry(0.55, 0).translate(0, 0.75, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: SCENE.tree, flatShading: true }), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  const at = new THREE.Vector3();
  spots.forEach(([x, y], k) => {
    const s = 0.7 + rand() * 0.7;
    scale.set(s, s * (0.9 + rand() * 0.5), s);
    q.setFromAxisAngle(up, rand() * Math.PI);
    m.compose(at.set(x, heights.groundAt(x, y), y), q, scale);
    mesh.setMatrixAt(k, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
