import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Terrain, type FloodState, type SurvivorView, type TaskView, type World } from '../types';
import { COLORS, droneColor } from './palette';
import type { HeightFn } from './droneLayer';

// ---------------------------------------------------------------------------
// Task rectangles
// ---------------------------------------------------------------------------

export class TaskLayer {
  readonly root = new THREE.Group();
  private readonly lines = new Map<number, { line: Line2; sig: string }>();

  constructor(private readonly origin: THREE.Vector2, private readonly resolution: THREE.Vector2) {}

  update(tasks: TaskView[], heightAt: HeightFn, t: number): void {
    const seen = new Set<number>();
    for (const task of tasks) {
      seen.add(task.id);
      const sig = `${task.x0},${task.y0},${task.x1},${task.y1},${task.assignedDrone},${Math.round(task.priority * 10)},${task.isFrontier}`;
      let entry = this.lines.get(task.id);
      if (!entry) {
        const line = new Line2(new LineGeometry(), new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, resolution: this.resolution }));
        line.frustumCulled = false;
        entry = { line, sig: '' };
        this.lines.set(task.id, entry);
        this.root.add(line);
      }
      const mat = entry.line.material as LineMaterial;
      if (entry.sig !== sig) {
        entry.sig = sig;
        const geo = new LineGeometry();
        geo.setPositions(this.outline(task, heightAt));
        entry.line.geometry.dispose();
        entry.line.geometry = geo;
        const assigned = task.assignedDrone !== null;
        mat.color.copy(assigned ? droneColor(task.assignedDrone!) : new THREE.Color(0xffffff));
        mat.linewidth = 1.5 + task.priority * 3.5;
      }
      const assigned = task.assignedDrone !== null;
      const base = assigned ? 0.55 + task.priority * 0.45 : 0.18 + task.priority * 0.3;
      mat.opacity = task.searchedFrac >= 0.999 ? base * 0.3 : base * (assigned ? 0.85 + 0.15 * Math.sin(t * 4 + task.id) : 1);
    }
    for (const [id, e] of this.lines) {
      if (seen.has(id)) continue;
      this.root.remove(e.line);
      e.line.geometry.dispose();
      (e.line.material as THREE.Material).dispose();
      this.lines.delete(id);
    }
  }

  private outline(task: TaskView, heightAt: HeightFn): number[] {
    const inset = 0.15;
    const x0 = task.x0 + inset, y0 = task.y0 + inset, x1 = task.x1 - inset, y1 = task.y1 - inset;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    const pts: number[] = [];
    for (let c = 0; c < 4; c++) {
      const [ax, ay] = corners[c];
      const [bx, by] = corners[c + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let s = 0; s < steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const y = ay + ((by - ay) * s) / steps;
        pts.push(x - this.origin.x, heightAt(x, y) + 0.35, y - this.origin.y);
      }
    }
    pts.push(x0 - this.origin.x, heightAt(x0, y0) + 0.35, y0 - this.origin.y);
    return pts;
  }

  dispose(): void {
    for (const e of this.lines.values()) {
      e.line.geometry.dispose();
      (e.line.material as THREE.Material).dispose();
    }
    this.lines.clear();
  }
}

// ---------------------------------------------------------------------------
// Survivors
// ---------------------------------------------------------------------------

const pinHeadGeo = new THREE.OctahedronGeometry(0.7, 0);
const pinStemGeo = new THREE.ConeGeometry(0.35, 1.4, 8).rotateX(Math.PI);
const beamGeo = new THREE.CylinderGeometry(0.35, 0.6, 26, 12, 1, true).translate(0, 13, 0);
const pulseGeo = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
const dotGeo = new THREE.SphereGeometry(0.75, 12, 8);
const xBarGeo = new THREE.BoxGeometry(2.6, 0.3, 0.55);

interface SurvivorObj {
  group: THREE.Group;
  found: THREE.Group;
  ghost: THREE.Mesh;
  lost: THREE.Group;
  pulse: THREE.Mesh;
  beam: THREE.Mesh;
  foundAtWall: number;
}

export class SurvivorLayer {
  readonly root = new THREE.Group();
  showGroundTruth = false;
  private readonly objs = new Map<number, SurvivorObj>();
  private readonly headMat = new THREE.MeshLambertMaterial({ color: COLORS.survivor, emissive: COLORS.survivor, emissiveIntensity: 0.7 });
  private readonly ghostMat = new THREE.MeshBasicMaterial({ color: COLORS.survivorGlow, transparent: true, opacity: 0.55 });
  private readonly lostMat = new THREE.MeshLambertMaterial({ color: 0x1d1f2b });

  constructor(private readonly origin: THREE.Vector2) {}

  update(survivors: SurvivorView[], heightAt: HeightFn, t: number): void {
    const seen = new Set<number>();
    for (const s of survivors) {
      seen.add(s.id);
      let o = this.objs.get(s.id);
      if (!o) {
        o = this.create();
        this.objs.set(s.id, o);
        this.root.add(o.group);
      }
      const ground = heightAt(s.x, s.y);
      o.group.position.set(s.x - this.origin.x, ground, s.y - this.origin.y);
      o.found.visible = s.found;
      o.ghost.visible = this.showGroundTruth && !s.found && !s.lost;
      o.lost.visible = this.showGroundTruth && s.lost && !s.found;
      if (s.found) {
        if (o.foundAtWall < 0) o.foundAtWall = t;
        const age = t - o.foundAtWall;
        const pop = Math.min(1, age * 3);
        const bounce = 1 + Math.sin(Math.min(1, age * 2) * Math.PI) * 0.6;
        o.found.scale.setScalar(pop * bounce);
        const head = o.found.children[0];
        head.position.y = 3 + Math.sin(t * 3 + s.id) * 0.3;
        head.rotation.y = t * 1.5;
        const ph = (t * 0.8 + s.id * 0.37) % 1;
        o.pulse.scale.setScalar(1 + ph * 5);
        (o.pulse.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.8;
        (o.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.12 * Math.sin(t * 5 + s.id);
      } else {
        o.foundAtWall = -1;
      }
    }
    for (const [id, o] of this.objs) {
      if (seen.has(id)) continue;
      this.root.remove(o.group);
      (o.pulse.material as THREE.Material).dispose();
      (o.beam.material as THREE.Material).dispose();
      this.objs.delete(id);
    }
  }

  private create(): SurvivorObj {
    const group = new THREE.Group();
    const found = new THREE.Group();
    const head = new THREE.Group();
    const h = new THREE.Mesh(pinHeadGeo, this.headMat);
    const stem = new THREE.Mesh(pinStemGeo, this.headMat);
    stem.position.y = -1.1;
    head.add(h, stem);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: COLORS.survivorGlow, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const pulse = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: COLORS.survivor, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    pulse.position.y = 0.2;
    found.add(head, beam, pulse);
    const ghost = new THREE.Mesh(dotGeo, this.ghostMat);
    ghost.position.y = 0.9;
    const lost = new THREE.Group();
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(xBarGeo, this.lostMat);
      bar.rotation.y = r;
      bar.position.y = 0.2;
      lost.add(bar);
    }
    group.add(found, ghost, lost);
    return { group, found, ghost, lost, pulse, beam, foundAtWall: -1 };
  }

  dispose(): void {
    for (const o of this.objs.values()) {
      (o.pulse.material as THREE.Material).dispose();
      (o.beam.material as THREE.Material).dispose();
    }
    this.headMat.dispose();
    this.ghostMat.dispose();
    this.lostMat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Frontier glow tiles (separate additive instanced quads so they can pulse cheaply)
// ---------------------------------------------------------------------------

export class FrontierLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(private readonly world: World, private readonly columnTop: Float32Array) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: COLORS.frontier, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, world.terrain.length);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  rebuild(frontier: Uint8Array): void {
    const { width, height } = this.world.meta;
    const m = new THREE.Matrix4();
    let c = 0;
    for (let i = 0; i < frontier.length; i++) {
      if (!frontier[i]) continue;
      const x = i % width, y = (i - x) / width;
      m.makeTranslation(x + 0.5 - width / 2, this.columnTop[i] + 0.05, y + 0.5 - height / 2);
      this.mesh.setMatrixAt(c++, m);
    }
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  animate(t: number): void {
    this.mat.opacity = 0.35 + 0.25 * Math.sin(t * 3.2);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// Tsunami: pre-impact warning tiles on the low coast + rising water after impact
// ---------------------------------------------------------------------------

export class FloodLayer {
  readonly root = new THREE.Group();
  private readonly warn: THREE.InstancedMesh;
  private readonly warnMat: THREE.MeshBasicMaterial;
  private readonly water: THREE.Mesh;
  private readonly waterMat: THREE.MeshLambertMaterial;
  private warnRunup = -1;
  private impactAt = -1;

  constructor(private readonly world: World, private readonly groundTop: Float32Array, private readonly vScale: number) {
    const { width, height } = world.meta;
    this.warnMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
    this.warn = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.warnMat, world.terrain.length);
    this.warn.count = 0;
    this.warn.frustumCulled = false;
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x3a9be8, transparent: true, opacity: 0.8, emissive: 0x0b3a6e, emissiveIntensity: 0.5 });
    this.water = new THREE.Mesh(new THREE.BoxGeometry(width, 1, height).translate(0, -0.5, 0), this.waterMat);
    this.water.visible = false;
    this.root.add(this.warn, this.water);
  }

  update(flood: FloodState | null, t: number): void {
    if (!flood) {
      this.warn.visible = false;
      this.water.visible = false;
      this.impactAt = -1;
      return;
    }
    if (flood.runupM !== this.warnRunup) this.buildWarning(flood.runupM);
    if (!flood.impacted) {
      this.impactAt = -1;
      this.water.visible = false;
      this.warn.visible = true;
      const urgency = flood.timeToImpact < 30 ? 2.5 : 1;
      this.warnMat.opacity = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 4 * urgency));
      return;
    }
    if (this.impactAt < 0) this.impactAt = t;
    const p = Math.min(1, (t - this.impactAt) / 2);
    const ease = 1 - Math.pow(1 - p, 3);
    this.warn.visible = p < 1;
    this.warnMat.opacity = 0.3 * (1 - p);
    this.water.visible = true;
    const level = Math.max(0.1, flood.runupM * this.vScale * ease + 0.08);
    this.water.scale.y = level + 3;
    this.water.position.y = level;
    this.waterMat.opacity = 0.74 + 0.06 * Math.sin(t * 2);
  }

  private buildWarning(runupM: number): void {
    this.warnRunup = runupM;
    const { width, height } = this.world.meta;
    const m = new THREE.Matrix4();
    let c = 0;
    for (let i = 0; i < this.world.terrain.length; i++) {
      if (this.world.terrain[i] === Terrain.Water || this.world.elevation[i] > runupM) continue;
      const x = i % width, y = (i - x) / width;
      m.makeTranslation(x + 0.5 - width / 2, this.groundTop[i] + 0.06, y + 0.5 - height / 2);
      this.warn.setMatrixAt(c++, m);
    }
    this.warn.count = c;
    this.warn.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.warn.geometry.dispose();
    this.warnMat.dispose();
    this.water.geometry.dispose();
    this.waterMat.dispose();
  }
}
