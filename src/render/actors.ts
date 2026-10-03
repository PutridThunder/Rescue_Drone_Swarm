import * as THREE from 'three';
import type { CrowdView, DroneView, SimState, SurvivorView, TruckView } from '../types';
import type { CityLayer } from './cityLayer';
import { droneColor, SCENE } from './palette';

const DRONE_SCALE = 0.7; // world units; exaggerated (~5 m) so drones read at city scale
const TRUCK_ROOF = 0.42;

type HeightFn = (x: number, y: number) => number;

function lambert(color: number, extra: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

class DroneActor {
  readonly group = new THREE.Group();
  private readonly craft = new THREE.Group();
  private readonly rotors: THREE.Mesh[] = [];
  private readonly body: THREE.MeshLambertMaterial;
  private readonly sensor: THREE.Mesh;
  private readonly stalk: THREE.Line;
  private readonly path: THREE.Line;
  private readonly trail: THREE.Line;
  private alt = 0;
  private pathKey = '';
  private trailLen = -1;

  constructor(
    readonly id: number,
    private readonly scene: THREE.Group,
  ) {
    const color = droneColor(id);
    this.body = lambert(color);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.9), this.body);
    hull.castShadow = true;
    this.craft.add(hull);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0xffffff));
    canopy.position.y = 0.12;
    this.craft.add(canopy);
    const armMat = lambert(0x2b3445);
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0x2b3445, transparent: true, opacity: 0.35 });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.12), armMat);
      arm.rotation.y = a;
      this.craft.add(arm);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 16), rotorMat);
      rotor.position.set(Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75);
      this.craft.add(rotor);
      this.rotors.push(rotor);
    }
    this.craft.scale.setScalar(DRONE_SCALE);
    this.group.add(this.craft);

    this.sensor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    this.sensor.renderOrder = 3;
    scene.add(this.sensor);

    const stalkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]);
    this.stalk = new THREE.Line(stalkGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
    this.group.add(this.stalk);

    this.path = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.85 }),
    );
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 }));
    scene.add(this.path, this.trail, this.group);
  }

  update(d: DroneView, ctx: ActorContext, t: number, dt: number) {
    const { city, flightUnits, trucks } = ctx;
    const ground = city.heightAt(d.x, d.y);
    const disabled = d.status === 'DISABLED';
    let target: number;
    if (disabled) target = city.surfaceAt(d.x, d.y) + 0.15;
    else if (d.dockedTruck !== null) target = ground + TRUCK_ROOF + 0.12;
    else target = ground + flightUnits + Math.sin(t * 2.4 + d.id) * 0.06;
    this.alt += (target - this.alt) * Math.min(1, dt * (d.dockedTruck !== null ? 5 : 3));
    if (this.pathKey === '') this.alt = target;

    let x = d.x;
    let y = d.y;
    if (d.dockedTruck !== null) {
      const tr = trucks.get(d.dockedTruck);
      if (tr) {
        x = tr.x;
        y = tr.y;
      }
    }
    this.group.position.set(x, this.alt, y);
    this.group.rotation.y = -d.heading;
    this.craft.rotation.z = disabled ? 0.6 : 0;
    const spin = disabled || d.dockedTruck !== null ? 0 : dt * 40;
    for (const r of this.rotors) r.rotation.y += spin;
    this.body.color.setHex(disabled ? 0x9aa3b2 : droneColor(this.id));

    const airborne = !disabled && d.dockedTruck === null;
    this.stalk.visible = airborne;
    this.stalk.scale.y = Math.max(0.01, this.alt - ground);
    this.sensor.visible = airborne && ctx.showSensors;
    this.sensor.position.set(x, ground + 0.12, y);
    this.sensor.scale.setScalar(d.sensorRange);

    const key = `${d.path.length}:${d.path[0]?.x ?? 0}:${d.path[0]?.y ?? 0}:${airborne}`;
    if (key !== this.pathKey) {
      this.pathKey = key;
      const pts = airborne && ctx.showPaths ? [{ x: d.x, y: d.y }, ...d.path] : [];
      this.path.geometry.setFromPoints(pts.map((p) => new THREE.Vector3(p.x, city.heightAt(p.x, p.y) + flightUnits, p.y)));
      this.path.computeLineDistances();
    } else if (airborne && d.path.length) {
      // Keep the first segment glued to the drone.
      const pos = this.path.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (pos && pos.count > 0) {
        pos.setXYZ(0, d.x, this.alt, d.y);
        pos.needsUpdate = true;
      }
    }
    if (d.trail.length !== this.trailLen) {
      this.trailLen = d.trail.length;
      const pts = ctx.showPaths ? d.trail.slice(-120) : [];
      this.trail.geometry.setFromPoints(pts.map((p) => new THREE.Vector3(p.x, city.heightAt(p.x, p.y) + flightUnits * 0.98, p.y)));
    }
  }

  dispose() {
    this.scene.remove(this.group, this.sensor, this.path, this.trail);
  }
}

class TruckActor {
  readonly group = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly route: THREE.Line;
  private routeKey = '';

  constructor(
    readonly id: number,
    private readonly scene: THREE.Group,
  ) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.38, 0.72), lambert(SCENE.truckBody));
    body.position.set(-0.15, 0.25, 0);
    body.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.68), lambert(SCENE.truckCab));
    cab.position.set(0.78, 0.23, 0);
    cab.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.07, 0.74), lambert(SCENE.truckAccent));
    stripe.position.set(-0.15, 0.2, 0);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 24), lambert(SCENE.truckAccent));
    pad.position.set(-0.15, TRUCK_ROOF + 0.01, 0);
    const padInner = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 24), lambert(0xffffff));
    padInner.position.copy(pad.position);
    this.group.add(body, cab, stripe, pad, padInner);
    const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12).rotateX(Math.PI / 2);
    const wheelMat = lambert(0x2b3445);
    for (const [wx, wz] of [
      [0.6, 0.36],
      [0.6, -0.36],
      [-0.55, 0.36],
      [-0.55, -0.36],
    ]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(wx, 0.12, wz);
      this.group.add(w);
      this.wheels.push(w);
    }
    this.route = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: SCENE.truckAccent, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.9 }),
    );
    scene.add(this.group, this.route);
  }

  update(tr: TruckView, ctx: ActorContext, dt: number) {
    const h = ctx.city.heightAt(tr.x, tr.y);
    this.group.position.set(tr.x, h + 0.02, tr.y);
    this.group.rotation.y = -tr.heading;
    if (tr.status === 'DRIVING') for (const w of this.wheels) w.rotation.z -= dt * 8;
    const key = `${tr.path.length}:${tr.path[tr.path.length - 1]?.x ?? 0}`;
    if (key !== this.routeKey) {
      this.routeKey = key;
      const pts = ctx.showPaths ? [{ x: tr.x, y: tr.y }, ...tr.path] : [];
      this.route.geometry.setFromPoints(pts.map((p) => new THREE.Vector3(p.x, ctx.city.heightAt(p.x, p.y) + 0.12, p.y)));
      this.route.computeLineDistances();
    }
  }

  dispose() {
    this.scene.remove(this.group, this.route);
  }
}

class SurvivorMarker {
  readonly group = new THREE.Group();
  private readonly pinMat: THREE.MeshLambertMaterial;
  private readonly ring: THREE.Mesh;
  private readonly beam: THREE.Mesh;

  constructor(
    private readonly s: SurvivorView,
    ctx: ActorContext,
  ) {
    this.pinMat = lambert(SCENE.survivorHidden, { transparent: true });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), this.pinMat);
    head.position.y = 1.15;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 14).rotateX(Math.PI), this.pinMat);
    cone.position.y = 0.7;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.75, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: SCENE.survivorFound, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.ring.position.y = 0.05;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 6, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: SCENE.survivorFound, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.beam.position.y = 3;
    this.group.add(head, cone, this.ring, this.beam);
    this.group.position.set(s.x, ctx.city.surfaceAt(s.x, s.y), s.y);
  }

  update(ctx: ActorContext, t: number) {
    const s = this.s;
    const visible = s.found || s.lost || s.placed || ctx.revealHidden;
    this.group.visible = visible;
    if (!visible) return;
    if (s.found) {
      this.pinMat.color.setHex(SCENE.survivorFound);
      this.pinMat.opacity = 1;
      const p = (t * 0.8 + s.id * 0.37) % 1;
      this.ring.visible = true;
      this.ring.scale.setScalar(1 + p * 1.8);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - p);
      this.beam.visible = true;
    } else {
      this.pinMat.color.setHex(s.lost ? 0x4a5363 : SCENE.survivorHidden);
      this.pinMat.opacity = s.lost ? 0.9 : 0.55;
      this.ring.visible = false;
      this.beam.visible = false;
    }
    this.group.scale.setScalar(s.found ? 1 : 0.8);
  }
}

class CrowdMarker {
  readonly group = new THREE.Group();

  constructor(c: CrowdView, ctx: ActorContext) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(c.radius, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: SCENE.crowd, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    disc.renderOrder = 3;
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(c.radius - 0.12, c.radius, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: SCENE.crowd, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    edge.renderOrder = 3;
    this.group.add(disc, edge);
    const mat = lambert(SCENE.crowd);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = k === 0 ? 0 : c.radius * 0.45;
      const person = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.3, 4, 8), mat);
      person.position.set(Math.cos(a) * r, 0.35, Math.sin(a) * r);
      this.group.add(person);
    }
    this.group.position.set(c.x, ctx.city.heightAt(c.x, c.y) + 0.1, c.y);
  }
}

export interface ActorContext {
  city: CityLayer;
  flightUnits: number;
  trucks: Map<number, TruckView>;
  showPaths: boolean;
  showSensors: boolean;
  revealHidden: boolean;
}

/** Owns every moving/placed thing in the scene and keeps them in sync with SimState. */
export class ActorLayer {
  readonly group = new THREE.Group();
  private drones = new Map<number, DroneActor>();
  private trucks = new Map<number, TruckActor>();
  private survivors = new Map<SurvivorView, SurvivorMarker>();
  private crowds = new Map<CrowdView, CrowdMarker>();
  private stateRef: SimState | null = null;
  showPaths = true;
  showSensors = true;
  revealHidden = false;

  constructor(
    private readonly city: CityLayer,
    offset: THREE.Vector3,
  ) {
    this.group.position.copy(offset);
  }

  update(state: SimState, t: number, dt: number) {
    if (state !== this.stateRef) this.reset(state);
    const truckMap = new Map(state.trucks.map((tr) => [tr.id, tr]));
    const ctx: ActorContext = {
      city: this.city,
      flightUnits: state.config.flightAltitudeM / this.city.mPerUnit,
      trucks: truckMap,
      showPaths: this.showPaths,
      showSensors: this.showSensors,
      revealHidden: this.revealHidden,
    };
    for (const tr of state.trucks) {
      let a = this.trucks.get(tr.id);
      if (!a) this.trucks.set(tr.id, (a = new TruckActor(tr.id, this.group)));
      a.update(tr, ctx, dt);
    }
    for (const d of state.drones) {
      let a = this.drones.get(d.id);
      if (!a) this.drones.set(d.id, (a = new DroneActor(d.id, this.group)));
      a.update(d, ctx, t, dt);
    }
    this.syncList(state.survivors, this.survivors, (s) => new SurvivorMarker(s, ctx));
    for (const m of this.survivors.values()) m.update(ctx, t);
    this.syncList(state.crowds, this.crowds, (c) => new CrowdMarker(c, ctx));
  }

  /** World-space position of a drone (for camera follow). */
  dronePosition(id: number, out: THREE.Vector3): boolean {
    const a = this.drones.get(id);
    if (!a) return false;
    a.group.getWorldPosition(out);
    return true;
  }

  dronesWorld(): { id: number; pos: THREE.Vector3 }[] {
    return [...this.drones.values()].map((a) => ({ id: a.id, pos: a.group.getWorldPosition(new THREE.Vector3()) }));
  }

  private syncList<K extends object, M extends { group: THREE.Group }>(items: K[], map: Map<K, M>, make: (k: K) => M) {
    const live = new Set(items);
    for (const [k, m] of map) {
      if (!live.has(k)) {
        this.group.remove(m.group);
        map.delete(k);
      }
    }
    for (const k of items) {
      if (!map.has(k)) {
        const m = make(k);
        map.set(k, m);
        this.group.add(m.group);
      }
    }
  }

  private reset(state: SimState) {
    this.stateRef = state;
    for (const a of this.drones.values()) a.dispose();
    for (const a of this.trucks.values()) a.dispose();
    for (const m of this.survivors.values()) this.group.remove(m.group);
    for (const m of this.crowds.values()) this.group.remove(m.group);
    this.drones.clear();
    this.trucks.clear();
    this.survivors.clear();
    this.crowds.clear();
  }
}

export type { HeightFn };
