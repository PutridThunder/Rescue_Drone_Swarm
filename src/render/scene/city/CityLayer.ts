// The static city: terrain, backdrop, trees, roads, buildings and street names, plus the
// knowledge overlay that shows what the fleet has searched.

import * as THREE from "three";
import type { MapJSON, SimState, World } from "../../../types";
import { buildBackdrop } from "./backdrop";
import { Buildings } from "./Buildings";
import { HeightField } from "./HeightField";
import { KnowledgeOverlay } from "./KnowledgeOverlay";
import { buildRoads } from "./roads";
import { StreetLabels } from "./StreetLabels";
import { buildTerrainMesh } from "./terrain";
import { buildTrees } from "./trees";

export class CityLayer {
  /** Positioned so the map is centred on the origin; children use grid coordinates. */
  readonly group = new THREE.Group();
  /** Meshes the mouse can pick (terrain and buildings). */
  readonly pickables: THREE.Object3D[] = [];
  readonly heights: HeightField;
  private readonly overlay: KnowledgeOverlay;
  private readonly buildings: Buildings | null = null;
  private readonly labels: StreetLabels | null = null;

  constructor(world: World, map: MapJSON | null) {
    this.heights = new HeightField(world);
    this.group.position.set(-world.meta.width / 2, 0, -world.meta.height / 2);

    const terrain = buildTerrainMesh(world);
    this.overlay = new KnowledgeOverlay(world, terrain.geometry);
    this.group.add(terrain, this.overlay.mesh, buildBackdrop(world), buildTrees(world, this.heights));
    this.pickables.push(terrain);

    if (map) {
      this.buildings = new Buildings(map, this.heights);
      this.labels = new StreetLabels(map, this.heights);
      this.group.add(buildRoads(map, this.heights), this.buildings.mesh, this.labels.group);
      this.pickables.push(this.buildings.mesh);
    }
  }

  setFloodMask(mask: Uint8Array | null) {
    this.overlay.setFloodMask(mask);
  }

  setLabelsVisible(visible: boolean) {
    this.labels?.setVisible(visible);
  }

  /** Repaint what changed in the fleet's knowledge since the last frame. */
  update(state: SimState, dirtyCells: number[], dt: number) {
    const repaintedAll = this.overlay.update(state, dirtyCells, dt);
    if (!this.buildings) return;
    if (repaintedAll) this.buildings.invalidateAll();
    else for (const i of dirtyCells) this.buildings.invalidateCell(i);
    this.buildings.repaint(state);
  }
}
