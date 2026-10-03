import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type { KnowledgeView, SimState, World } from '../types';
import { DroneLayer } from './droneLayer';
import { FloodLayer, FrontierLayer, SurvivorLayer, TaskLayer } from './markerLayers';
import { TerrainLayer, type OverlayFlags } from './terrainLayer';

export type OverlayName = 'fog' | 'frontier' | 'hazard' | 'population' | 'paths' | 'tasks' | 'sensors' | 'groundTruth';

const DEFAULT_OVERLAYS: Record<OverlayName, boolean> = {
  fog: true,
  frontier: true,
  hazard: true,
  population: false,
  paths: true,
  tasks: true,
  sensors: true,
  groundTruth: false,
};

export class Renderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly controls: MapControls;
  private readonly terrain: TerrainLayer;
  private readonly frontier: FrontierLayer;
  private readonly drones: DroneLayer;
  private readonly tasks: TaskLayer;
  private readonly survivors: SurvivorLayer;
  private readonly flood: FloodLayer;
  private readonly origin: THREE.Vector2;
  private readonly resolution = new THREE.Vector2(1, 1);
  private readonly overlays = { ...DEFAULT_OVERLAYS };
  private readonly viewSize: number;
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private lastKnowledge: KnowledgeView | null = null;
  private needsFullRecolor = true;
  private elapsed = 0;

  constructor(private readonly container: HTMLElement, private readonly world: World) {
    const { width, height } = world.meta;
    this.origin = new THREE.Vector2(width / 2, height / 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.classList.add('sar-canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.background = 'radial-gradient(ellipse at 50% 35%, #2b3a67 0%, #161d38 55%, #0b0f20 100%)';
    container.appendChild(canvas);

    // Camera: orthographic 3/4 view from the south-southeast (sea in front, mountains behind).
    this.viewSize = Math.max(width, height) * 0.62;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
    const dist = 500;
    this.camera.position.set(dist * 0.35, dist * 0.78, dist * 0.75);
    this.camera.zoom = 0.72;
    this.controls = new MapControls(this.camera, canvas);
    this.controls.target.set(0, 0, 6);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.minZoom = 0.6;
    this.controls.maxZoom = 12;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.25;
    this.controls.zoomToCursor = true;
    this.controls.update();

    // Lighting
    this.scene.add(new THREE.HemisphereLight(0xe4ecff, 0x40385a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(-90, 160, 70);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    const half = Math.max(width, height) * 0.62;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);

    this.terrain = new TerrainLayer(world);
    this.scene.add(this.terrain.mesh);
    this.addOceanAndBase();

    this.frontier = new FrontierLayer(world, this.terrain.columnTop);
    this.flood = new FloodLayer(world, this.terrain.groundTop, this.terrain.vScale);
    this.tasks = new TaskLayer(this.origin, this.resolution);
    this.survivors = new SurvivorLayer(this.origin);
    this.drones = new DroneLayer(this.origin, this.resolution);
    this.scene.add(this.frontier.mesh, this.flood.root, this.tasks.root, this.survivors.root, this.drones.root);
    this.applyOverlayVisibility();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Column top (world units) at fractional sim coordinates. */
  private heightAt = (x: number, y: number): number => {
    const { width, height } = this.world.meta;
    const cx = Math.min(width - 1, Math.max(0, Math.floor(x)));
    const cy = Math.min(height - 1, Math.max(0, Math.floor(y)));
    return this.terrain.columnTop[cy * width + cx];
  };

  private addOceanAndBase(): void {
    const { width, height } = this.world.meta;
    // Slab under the whole diorama so the edges read as a solid block.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width + 2, 1.2, height + 2),
      new THREE.MeshLambertMaterial({ color: 0x232a4a }),
    );
    slab.position.y = -3.6;
    slab.receiveShadow = true;
    this.scene.add(slab);

    // Stylized flat water sheet over the water cells.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x5bb8f0, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    water.position.y = 0.12;
    water.receiveShadow = true;
    this.scene.add(water);

    // Helipad at the base.
    const { x, y } = this.world.base;
    const top = this.heightAt(x + 0.5, y + 0.5);
    const pad = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.3, 24), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff8a1f }));
    ring.position.y = 0.17;
    const hMat = new THREE.MeshBasicMaterial({ color: 0xff8a1f });
    const bar = (w: number, d: number, px: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), hMat);
      m.position.set(px, 0.17, 0);
      return m;
    };
    pad.add(disc, ring, bar(0.18, 1.1, -0.35), bar(0.18, 1.1, 0.35), bar(0.7, 0.16, 0));
    disc.castShadow = true;
    disc.receiveShadow = true;
    pad.position.set(x + 0.5 - width / 2, top + 0.15, y + 0.5 - height / 2);
    this.scene.add(pad);
  }

  private flags(): OverlayFlags {
    const o = this.overlays;
    return { fog: o.fog, frontier: o.frontier, hazard: o.hazard, population: o.population };
  }

  /** `dtOverride` (seconds) is for deterministic/offscreen stepping; normally omitted. */
  update(state: SimState, dirtyCells: number[], dtOverride?: number): void {
    const real = this.clock.getDelta();
    const dt = Math.min(0.1, dtOverride ?? real);
    this.elapsed += dt;
    const t = this.elapsed;
    const k = state.knowledge;

    if (k !== this.lastKnowledge) {
      this.lastKnowledge = k;
      this.needsFullRecolor = true;
    }
    if (this.needsFullRecolor) {
      this.terrain.recolor(k, this.flags(), null);
      this.frontier.rebuild(k.frontier);
      this.needsFullRecolor = false;
    } else if (dirtyCells.length) {
      this.terrain.recolor(k, this.flags(), dirtyCells);
      this.frontier.rebuild(k.frontier);
    }
    this.frontier.animate(t);

    this.drones.update(state.drones, this.heightAt, t, dt);
    this.tasks.update(state.tasks, this.heightAt, t);
    this.survivors.update(state.survivors, this.heightAt, t);
    this.flood.update(state.flood, t);
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setOverlay(name: OverlayName, on: boolean): void {
    if (this.overlays[name] === on) return;
    this.overlays[name] = on;
    if (name === 'fog' || name === 'frontier' || name === 'hazard' || name === 'population') this.needsFullRecolor = true;
    this.applyOverlayVisibility();
  }

  getOverlays(): Readonly<Record<OverlayName, boolean>> {
    return this.overlays;
  }

  private applyOverlayVisibility(): void {
    this.frontier.mesh.visible = this.overlays.frontier;
    this.tasks.root.visible = this.overlays.tasks;
    this.drones.showSensors = this.overlays.sensors;
    this.drones.showPaths = this.overlays.paths;
    this.survivors.showGroundTruth = this.overlays.groundTruth;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const vs = this.viewSize;
    this.camera.left = (-vs * aspect) / 2;
    this.camera.right = (vs * aspect) / 2;
    this.camera.top = vs / 2;
    this.camera.bottom = -vs / 2;
    this.camera.updateProjectionMatrix();
    this.resolution.set(w, h);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.terrain.dispose();
    this.frontier.dispose();
    this.drones.dispose();
    this.tasks.dispose();
    this.survivors.dispose();
    this.flood.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
