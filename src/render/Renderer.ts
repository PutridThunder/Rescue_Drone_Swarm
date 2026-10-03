import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { MapJSON, SimState, World } from "../types";
import { ActorLayer } from "./actors";
import { CityLayer } from "./cityLayer";
import { SCENE } from "./palette";

export interface RenderOptions {
  showPaths: boolean;
  showSensors: boolean;
  showLabels: boolean;
  revealHidden: boolean;
}

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: MapControls;
  private readonly city: CityLayer;
  private readonly actors: ActorLayer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly sun: THREE.DirectionalLight;
  private readonly offset: THREE.Vector3;
  private readonly resizeObserver: ResizeObserver;
  private follow: number | null = null;
  private readonly followPos = new THREE.Vector3();
  private clock = 0;
  private lastTime = performance.now();
  private labelsWanted = true;

  constructor(
    private readonly container: HTMLElement,
    private readonly world: World,
    map: MapJSON | null,
  ) {
    const { width: W, height: H } = world.meta;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "label-layer";
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = new THREE.Color(SCENE.background);
    this.scene.fog = new THREE.Fog(SCENE.background, 260, 520);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
    this.camera.position.set(-20, 95, 115);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 420;
    this.controls.screenSpacePanning = false;
    this.controls.target.set(-15, 0, 35);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde6, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-120, 180, 80);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -W / 2 - 10;
    sc.right = W / 2 + 10;
    sc.top = H / 2 + 10;
    sc.bottom = -H / 2 - 10;
    sc.near = 10;
    sc.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.city = new CityLayer(world, map);
    this.scene.add(this.city.group);
    this.offset = this.city.group.position.clone();
    this.actors = new ActorLayer(this.city, this.offset);
    this.scene.add(this.actors.group);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  update(state: SimState, dirtyCells: number[], floodMask: Uint8Array | null) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.clock += dt;
    this.city.setFloodMask(floodMask);
    this.city.update(state, dirtyCells, dt);
    this.actors.update(state, this.clock, dt);

    if (
      this.follow !== null &&
      this.actors.dronePosition(this.follow, this.followPos)
    ) {
      const delta = this.followPos.clone().sub(this.controls.target);
      delta.y = 0;
      const step = delta.multiplyScalar(Math.min(1, dt * 4));
      this.controls.target.add(step);
      this.camera.position.add(step);
    }
    this.controls.update();
    // Street names only when zoomed in enough to read them.
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.city.setLabelsVisible(this.labelsWanted && dist < 150);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  setOptions(o: Partial<RenderOptions>) {
    if (o.showPaths !== undefined) this.actors.showPaths = o.showPaths;
    if (o.showSensors !== undefined) this.actors.showSensors = o.showSensors;
    if (o.revealHidden !== undefined) this.actors.revealHidden = o.revealHidden;
    if (o.showLabels !== undefined) this.labelsWanted = o.showLabels;
  }

  /** Follow a drone with the camera (null to stop). Zooms in when starting to follow. */
  setFollow(id: number | null) {
    this.follow = id;
    if (id !== null && this.actors.dronePosition(id, this.followPos)) {
      const dir = this.camera.position
        .clone()
        .sub(this.controls.target)
        .normalize();
      const dist = Math.min(
        this.camera.position.distanceTo(this.controls.target),
        45,
      );
      this.controls.target.copy(this.followPos).setY(0);
      this.camera.position
        .copy(this.controls.target)
        .addScaledVector(dir, dist);
    }
  }

  get following(): number | null {
    return this.follow;
  }

  /** Grid coordinates (cells) under a screen point, or null. */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    this.setRay(clientX, clientY);
    const hit = this.raycaster.intersectObjects(this.city.pickables, false)[0];
    if (!hit) return null;
    const x = hit.point.x - this.offset.x;
    const y = hit.point.z - this.offset.z;
    if (
      x < 0 ||
      y < 0 ||
      x >= this.world.meta.width ||
      y >= this.world.meta.height
    )
      return null;
    return { x, y };
  }

  /** Drone whose on-screen position is within `radiusPx` of the point. */
  pickDrone(clientX: number, clientY: number, radiusPx = 28): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best: number | null = null;
    let bestD = radiusPx;
    for (const { id, pos } of this.actors.dronesWorld()) {
      const p = pos.project(this.camera);
      if (p.z > 1) continue;
      const sx = rect.left + ((p.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - p.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
    this.container.removeChild(this.labelRenderer.domElement);
  }

  private setRay(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }
}
