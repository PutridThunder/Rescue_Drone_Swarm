import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { DroneView } from '../types';
import { COLORS, droneColor } from './palette';

export type HeightFn = (x: number, y: number) => number; // sim coords -> column top (world units)

const HOVER = 6.5;
const MAX_TRAIL = 160;

const bodyGeo = new THREE.BoxGeometry(0.9, 0.32, 0.9);
const domeGeo = new THREE.BoxGeometry(0.42, 0.22, 0.42);
const armGeo = new THREE.BoxGeometry(1.9, 0.1, 0.16);
const rotorGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10);
const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.18, 6);
const discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const ringGeo = new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2);

class DroneObj {
  readonly group = new THREE.Group();
  readonly craft = new THREE.Group();
  readonly rotors: THREE.Mesh[] = [];
  readonly bodyMat: THREE.MeshLambertMaterial;
  readonly sensor: THREE.Mesh;
  readonly sensorRing: THREE.Mesh;
  readonly battery: THREE.Mesh;
  readonly batteryMat: THREE.MeshBasicMaterial;
  readonly path: Line2;
  readonly trail: Line2;
  readonly color: THREE.Color;
  alt = -1;
  tilt = 0;
  private lastBattery = -1;
  private pathSig = '';
  private trailFrame = 0;

  constructor(readonly id: number, private readonly origin: THREE.Vector2, resolution: THREE.Vector2) {
    this.color = droneColor(id);
    this.bodyMat = new THREE.MeshLambertMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 0.25 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2f45 });
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });

    const body = new THREE.Mesh(bodyGeo, this.bodyMat);
    body.castShadow = true;
    const dome = new THREE.Mesh(domeGeo, dark);
    dome.position.y = 0.24;
    this.craft.add(body, dome);
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(armGeo, dark);
      arm.rotation.y = rot;
      arm.castShadow = true;
      this.craft.add(arm);
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const hub = new THREE.Mesh(hubGeo, dark);
      hub.position.set(Math.cos(a) * 0.9, 0.08, Math.sin(a) * 0.9);
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(Math.cos(a) * 0.9, 0.18, Math.sin(a) * 0.9);
      rotor.scale.set(1, 1, 0.25); // blade-ish ellipse; spins around y
      this.rotors.push(rotor);
      this.craft.add(hub, rotor);
    }
    this.craft.scale.setScalar(4.2);

    this.batteryMat = new THREE.MeshBasicMaterial({ color: 0x5df08a, side: THREE.DoubleSide });
    this.battery = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), this.batteryMat);
    this.battery.rotation.x = -Math.PI / 2;
    this.battery.position.y = 0.55;
    this.craft.add(this.battery);
    this.group.add(this.craft);

    const sMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.1, depthWrite: false, depthTest: false });
    this.sensor = new THREE.Mesh(discGeo, sMat);
    this.sensor.renderOrder = 2;
    const rMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
    this.sensorRing = new THREE.Mesh(ringGeo, rMat);
    this.sensorRing.renderOrder = 3;

    this.path = new Line2(
      new LineGeometry(),
      new LineMaterial({ color: this.color.getHex(), linewidth: 3, dashed: true, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.95, resolution }),
    );
    this.path.frustumCulled = false;
    this.trail = new Line2(
      new LineGeometry(),
      new LineMaterial({ vertexColors: true, linewidth: 3, transparent: true, opacity: 0.7, resolution }),
    );
    this.trail.frustumCulled = false;
  }

  update(d: DroneView, heightAt: HeightFn, t: number, dt: number, showSensor: boolean, showPaths: boolean): void {
    const disabled = d.status === 'DISABLED';
    const wx = d.x - this.origin.x;
    const wz = d.y - this.origin.y;
    const ground = heightAt(d.x, d.y);
    const target = disabled ? ground + 0.25 : this.clearance(d, heightAt) + HOVER + Math.sin(t * 2.2 + this.id * 1.7) * 0.18;
    if (this.alt < 0) this.alt = target;
    const k = disabled ? Math.min(1, dt * 2.5) : Math.min(1, dt * 4);
    this.alt += (target - this.alt) * k;
    this.group.position.set(wx, this.alt, wz);
    this.group.rotation.y = -d.heading;
    this.tilt += ((disabled ? 0.55 : 0.12) - this.tilt) * Math.min(1, dt * 3);
    this.craft.rotation.z = -this.tilt;

    this.bodyMat.color.copy(disabled ? COLORS.disabled : this.color);
    this.bodyMat.emissiveIntensity = disabled ? 0 : 0.25;
    if (!disabled) for (const r of this.rotors) r.rotation.y += dt * 38;

    if (Math.abs(d.battery - this.lastBattery) > 0.01) {
      this.lastBattery = d.battery;
      const b = Math.max(0.001, Math.min(1, d.battery));
      this.battery.geometry.dispose();
      this.battery.geometry = new THREE.RingGeometry(0.75, 0.95, 32, 1, Math.PI / 2, b * Math.PI * 2);
      this.batteryMat.color.setHSL(0.33 * b, 0.9, 0.55);
    }
    this.battery.visible = !disabled;

    const sr = Math.max(0.5, d.sensorRange);
    const sensorOn = showSensor && !disabled;
    this.sensor.visible = this.sensorRing.visible = sensorOn;
    if (sensorOn) {
      this.sensor.position.set(wx, ground + 0.15, wz);
      this.sensor.scale.setScalar(sr);
      this.sensorRing.position.copy(this.sensor.position);
      this.sensorRing.scale.setScalar(sr);
      (this.sensorRing.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.2 * Math.sin(t * 3 + this.id);
    }

    this.path.visible = showPaths && !disabled && d.path.length > 0;
    this.trail.visible = showPaths && d.trail.length > 1;
    if (showPaths) {
      this.updatePath(d, heightAt);
      if (this.trailFrame++ % 4 === 0) this.updateTrail(d, heightAt, disabled);
      (this.path.material as LineMaterial).dashOffset -= dt * 2.5;
    }
  }

  private clearance(d: DroneView, heightAt: HeightFn): number {
    let h = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) h = Math.max(h, heightAt(d.x + dx, d.y + dy));
    return h;
  }

  private updatePath(d: DroneView, heightAt: HeightFn): void {
    const last = d.path[d.path.length - 1];
    const sig = `${d.path.length}:${last?.x}:${last?.y}:${Math.round(d.x * 2)}:${Math.round(d.y * 2)}`;
    if (sig === this.pathSig || d.path.length === 0) return;
    this.pathSig = sig;
    const pts: number[] = [];
    this.appendPolyline(pts, [{ x: d.x, y: d.y }, ...d.path.slice(0, 400)], heightAt, 1.2);
    this.setLine(this.path, pts);
    this.path.computeLineDistances();
  }

  private updateTrail(d: DroneView, heightAt: HeightFn, disabled: boolean): void {
    if (d.trail.length < 2) return;
    const src = d.trail.length > MAX_TRAIL ? d.trail.slice(d.trail.length - MAX_TRAIL) : d.trail;
    const pts: number[] = [];
    const cols: number[] = [];
    const c = disabled ? COLORS.disabled : this.color;
    const bg = new THREE.Color().copy(c).lerp(new THREE.Color('#ffffff'), 0.75);
    const tmp = new THREE.Color();
    src.forEach((p, idx) => {
      pts.push(p.x - this.origin.x, heightAt(p.x, p.y) + 0.9, p.y - this.origin.y);
      tmp.copy(bg).lerp(c, Math.pow(idx / (src.length - 1), 0.8));
      cols.push(tmp.r, tmp.g, tmp.b);
    });
    const geo = new LineGeometry();
    geo.setPositions(pts);
    geo.setColors(cols);
    this.trail.geometry.dispose();
    this.trail.geometry = geo;
  }

  private appendPolyline(out: number[], pts: { x: number; y: number }[], heightAt: HeightFn, lift: number): void {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      out.push(p.x - this.origin.x, heightAt(p.x, p.y) + lift, p.y - this.origin.y);
      if (!q) break;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const steps = Math.floor(len);
      for (let s = 1; s < steps; s++) {
        const x = p.x + ((q.x - p.x) * s) / steps;
        const y = p.y + ((q.y - p.y) * s) / steps;
        out.push(x - this.origin.x, heightAt(x, y) + lift, y - this.origin.y);
      }
    }
  }

  private setLine(line: Line2, pts: number[]): void {
    if (pts.length < 6) pts.push(pts[0], pts[1], pts[2]);
    const geo = new LineGeometry();
    geo.setPositions(pts);
    line.geometry.dispose();
    line.geometry = geo;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
    this.battery.geometry.dispose();
    for (const l of [this.path, this.trail]) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
    (this.sensor.material as THREE.Material).dispose();
    (this.sensorRing.material as THREE.Material).dispose();
  }
}

export class DroneLayer {
  readonly root = new THREE.Group();
  private readonly drones = new Map<number, DroneObj>();
  showSensors = true;
  showPaths = true;

  constructor(private readonly origin: THREE.Vector2, private readonly resolution: THREE.Vector2) {}

  update(views: DroneView[], heightAt: HeightFn, t: number, dt: number): void {
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let d = this.drones.get(v.id);
      if (!d) {
        d = new DroneObj(v.id, this.origin, this.resolution);
        this.drones.set(v.id, d);
        this.root.add(d.group, d.sensor, d.sensorRing, d.path, d.trail);
      }
      d.update(v, heightAt, t, dt, this.showSensors, this.showPaths);
    }
    for (const [id, d] of this.drones) {
      if (seen.has(id)) continue;
      this.root.remove(d.group, d.sensor, d.sensorRing, d.path, d.trail);
      d.dispose();
      this.drones.delete(id);
    }
  }

  dispose(): void {
    for (const d of this.drones.values()) d.dispose();
    this.drones.clear();
  }
}
