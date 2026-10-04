// The 3D view: city, actors, lighting, camera, HTML labels, picking, and the drone cam.

import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { MapJSON, SearchArea, SimState, World } from "../../types";
import { ActorLayer } from "./actors/ActorLayer";
import { CameraRig } from "./CameraRig";
import { CityLayer } from "./city/CityLayer";
import { DroneCam, type DroneCamStyle } from "./DroneCam";
import "./labels.css";
import { addLighting } from "./lighting";
import { SCENE } from "./palette";
import { QUALITY } from "./quality";

export interface RenderOptions {
  showPaths: boolean;
  showSensors: boolean;
  showLabels: boolean;
  revealHidden: boolean;
  /** Drape the Sentinel-2 image over the ground (only when the area has one). */
  showSatellite: boolean;
}

const LABELS_MAX_DISTANCE = 150; // street names hide when zoomed out further
const PICK_RADIUS_PX = 28;

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly city: CityLayer;
  private readonly actors: ActorLayer;
  private readonly droneCam = new DroneCam();
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly scratch = new THREE.Vector3();
  private follow: number | null = null;
  private camDrone: number | null = null;
  private camCanvas: HTMLCanvasElement | null = null;
  private labelsWanted = true;
  /** Full-screen view from the drone cam (instead of the map camera). */
  private droneView = false;
  private clock = 0;
  private lastTime = performance.now();

  constructor(
    private readonly container: HTMLElement,
    private readonly world: World,
    map: MapJSON | null,
  ) {
    const { width: W, height: H } = world.meta;
    this.renderer = new THREE.WebGLRenderer({ antialias: QUALITY.antialias });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false; // the city never moves: shadows are rendered once
    this.renderer.shadowMap.type = QUALITY.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "label-layer";
    container.append(this.renderer.domElement, this.labelRenderer.domElement);

    this.scene.background = new THREE.Color(SCENE.background);
    this.scene.fog = new THREE.Fog(SCENE.background, Math.max(W, H) * 1.0, Math.max(W, H) * 2.0);
    addLighting(this.scene, W, H);
    this.rig = new CameraRig(this.renderer.domElement, W, H);

    this.city = new CityLayer(world, map);
    this.actors = new ActorLayer(this.city.heights, this.city.group.position);
    this.scene.add(this.city.group, this.actors.group);
    this.renderer.shadowMap.needsUpdate = true;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get following(): number | null {
    return this.follow;
  }

  update(state: SimState, dirtyCells: number[], floodMask: Uint8Array | null) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.clock += dt;

    this.city.setFloodMask(floodMask);
    this.city.update(state, dirtyCells, dt);
    this.actors.update(state, this.clock, dt);
    if (this.follow !== null && this.actors.dronePose(this.follow, this.scratch) !== null) this.rig.track(this.scratch, dt);
    if (this.camDrone !== null) {
      const heading = this.actors.dronePose(this.camDrone, this.scratch);
      if (heading !== null) this.droneCam.follow(this.scratch, heading, dt);
    }
    this.rig.update();
    this.city.setLabelsVisible(this.labelsWanted && this.rig.distance < LABELS_MAX_DISTANCE);
  }

  render() {
    if (this.droneView && this.camDrone !== null) {
      this.droneCam.renderFull(this.renderer, this.scene);
      this.labelRenderer.render(this.scene, this.droneCam.camera);
      return;
    }
    // The drone cam borrows a corner of the canvas, so it must render before the main view.
    if (this.camDrone !== null && this.camCanvas) this.droneCam.renderTo(this.renderer, this.scene, this.camCanvas);
    this.renderer.render(this.scene, this.rig.camera);
    this.labelRenderer.render(this.scene, this.rig.camera);
  }

  /** Outline of a search circle being drawn (null: show the mission's own). */
  previewSearchArea(area: SearchArea | null) {
    this.city.previewSearchArea(area);
  }

  /** Freeze map panning and rotation (zoom still works), e.g. while drawing on the map. */
  setCameraLocked(locked: boolean) {
    this.rig.controls.enablePan = !locked;
    this.rig.controls.enableRotate = !locked;
  }

  /** Drone cam style: out of the gimbal or following behind. */
  setDroneCamStyle(style: DroneCamStyle) {
    this.droneCam.style = style;
  }

  /** Show the drone cam full screen (true) or the map (false). */
  setDroneView(on: boolean) {
    this.droneView = on;
  }

  setOptions(o: Partial<RenderOptions>) {
    if (o.showPaths !== undefined) this.actors.showPaths = o.showPaths;
    if (o.showSensors !== undefined) this.actors.showSensors = o.showSensors;
    if (o.revealHidden !== undefined) this.actors.revealHidden = o.revealHidden;
    if (o.showLabels !== undefined) this.labelsWanted = o.showLabels;
    if (o.showSatellite !== undefined) this.city.setSatellite(o.showSatellite);
  }

  /** Show what `droneId` sees in `canvas` (the drone cam window); null hides it. */
  setDroneCam(droneId: number | null, canvas: HTMLCanvasElement | null) {
    // canvas null with a drone id: track the drone (for the full-screen view) without a window.
    if (droneId !== this.camDrone) this.droneCam.reset();
    this.camDrone = droneId;
    this.camCanvas = canvas;
  }

  /** Follow a drone with the camera (null to stop), zooming in when following starts. */
  setFollow(id: number | null) {
    this.follow = id;
    if (id !== null && this.actors.dronePose(id, this.scratch) !== null) this.rig.focus(this.scratch);
  }

  /** Grid coordinates (cells) under a screen point, or null if off the map. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = this.raycaster.intersectObjects(this.city.pickables, false)[0];
    if (!hit) return null;
    const offset = this.city.group.position;
    const x = hit.point.x - offset.x;
    const y = hit.point.z - offset.z;
    return x >= 0 && y >= 0 && x < this.world.meta.width && y < this.world.meta.height ? { x, y } : null;
  }

  /** The drone drawn closest to a screen point (within PICK_RADIUS_PX), or null. */
  pickDrone(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    let best: number | null = null;
    let bestD = PICK_RADIUS_PX;
    for (const { id, pos } of this.actors.dronesWorld()) {
      const p = pos.project(this.rig.camera);
      if (p.z > 1) continue;
      const d = Math.hypot(rect.left + ((p.x + 1) / 2) * rect.width - clientX, rect.top + ((1 - p.y) / 2) * rect.height - clientY);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.rig.setAspect(w / h);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
