// Soft daylight: a sky/ground hemisphere light plus a sun casting shadows over the whole map.

import * as THREE from "three";
import { QUALITY } from "./quality";

const SHADOW_MARGIN = 10; // world units beyond the map edge

export function addLighting(scene: THREE.Scene, mapWidth: number, mapHeight: number) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde6, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-120, 180, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
  const cam = sun.shadow.camera;
  cam.left = -mapWidth / 2 - SHADOW_MARGIN;
  cam.right = mapWidth / 2 + SHADOW_MARGIN;
  cam.top = mapHeight / 2 + SHADOW_MARGIN;
  cam.bottom = -mapHeight / 2 - SHADOW_MARGIN;
  cam.near = 10;
  cam.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
}
