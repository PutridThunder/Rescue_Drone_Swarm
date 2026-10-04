// The static city: terrain, backdrop, trees, roads, buildings and street names, plus the
// knowledge overlay that shows what the fleet has searched.

import * as THREE from "three";
import type { MapJSON, SimState, World } from "../../../types";
import { buildBackdrop } from "./backdrop";
import { Buildings } from "./Buildings";
import { HeightField } from "./HeightField";
import { KnowledgeOverlay } from "./KnowledgeOverlay";
import { buildRoads } from "./roads";
import { SatelliteGround } from "./SatelliteGround";
import { SearchAreaRing } from "./SearchAreaRing";
import type { SearchArea } from "../../../shared/searchArea";
import { StreetLabels } from "./StreetLabels";
import { buildTerrainMesh } from "./terrain";
import { buildTrees } from "./trees";

const SATELLITE_OVERLAY_OPACITY = 0.55;

export class CityLayer {
  /** Positioned so the map is centred on the origin; children use grid coordinates. */
  readonly group = new THREE.Group();
  /** Meshes the mouse can pick (terrain and buildings). */
  readonly pickables: THREE.Object3D[] = [];
  readonly heights: HeightField;
  private readonly overlay: KnowledgeOverlay;
  private readonly buildings: Buildings | null = null;
  private readonly labels: StreetLabels | null = null;
  private readonly roads: THREE.Mesh | null = null;
  private readonly satellite: SatelliteGround | null;
  private readonly ring: SearchAreaRing;
  private preview: SearchArea | null = null;

  constructor(world: World, map: MapJSON | null) {
    this.heights = new HeightField(world);
    this.group.position.set(-world.meta.width / 2, 0, -world.meta.height / 2);

    const terrain = buildTerrainMesh(world);
    this.overlay = new KnowledgeOverlay(world, terrain.geometry);
    this.group.add(terrain, this.overlay.mesh, buildBackdrop(world), buildTrees(world, this.heights));
    this.pickables.push(terrain);
    this.ring = new SearchAreaRing(this.heights);
    this.group.add(this.ring.mesh);
    this.satellite = world.eo?.satelliteUrl ? new SatelliteGround(terrain, world.eo.satelliteUrl) : null;

    if (map) {
      this.buildings = new Buildings(map, this.heights);
      this.labels = new StreetLabels(map, this.heights);
      this.roads = buildRoads(map, this.heights);
      this.group.add(this.roads, this.buildings.mesh, this.labels.group);
      this.pickables.push(this.buildings.mesh);
    }
  }

  setFloodMask(mask: Uint8Array | null) {
    this.overlay.setFloodMask(mask);
  }

  /** Swap the map-coloured ground for the satellite image (roads are in the photo already). */
  setSatellite(on: boolean) {
    if (!this.satellite) return;
    this.satellite.setOn(on);
    if (this.roads) this.roads.visible = !on;
    (this.overlay.mesh.material as THREE.Material).opacity = on ? SATELLITE_OVERLAY_OPACITY : 1; // keep the photo readable
  }

  setLabelsVisible(visible: boolean) {
    this.labels?.setVisible(visible);
  }

  /** Show a circle being drawn (null: back to the mission's search area). */
  previewSearchArea(area: SearchArea | null) {
    this.preview = area;
  }

  /** Repaint what changed in the fleet's knowledge since the last frame. */
  update(state: SimState, dirtyCells: number[], dt: number) {
    if (this.preview) this.ring.set(this.preview, true);
    else this.ring.set(state.config.searchArea);
    const repaintedAll = this.overlay.update(state, dirtyCells, dt);
    if (!this.buildings) return;
    this.buildings.areaMask = this.overlay.areaMask;
    if (repaintedAll) this.buildings.invalidateAll();
    else for (const i of dirtyCells) this.buildings.invalidateCell(i);
    this.buildings.repaint(state);
  }
}
