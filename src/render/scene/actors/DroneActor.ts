// A quadcopter: body, spinning rotors, altitude stalk, camera footprint, planned path and trail.

import * as THREE from "three";
import type { DroneView } from "../../../types";
import { droneColor } from "../palette";
import { disposeObject, GEOMETRY, MATERIAL, overlayMaterial, TRUCK_ROOF, type ActorContext, setLinePoints } from "./shared";

const SCALE = 0.7; // world units; exaggerated (~7 m) so drones read at city scale
const DOWN_COLOR = 0x9aa3b2;
const TRAIL_POINTS = 120;
const ROTOR_SPEED = 40; // rad/s
const BOB = 0.06; // hover bob amplitude (world units)

export class DroneActor {
  readonly group = new THREE.Group();
  private readonly craft = new THREE.Group();
  private readonly rotors: THREE.Mesh[] = [];
  private readonly body: THREE.MeshLambertMaterial;
  private readonly footprint: THREE.Mesh;
  private readonly stalk: THREE.Line;
  private readonly path: THREE.Line;
  private readonly trail: THREE.Line;
  private altitude: number | null = null;
  private pathKey = "";
  private trailKey = "";
  private wasDown = false;

  constructor(
    readonly id: number,
    parent: THREE.Group,
  ) {
    const color = droneColor(id);
    this.body = new THREE.MeshLambertMaterial({ color });
    const canopy = new THREE.Mesh(GEOMETRY.droneCanopy, MATERIAL.white);
    canopy.position.y = 0.12;
    this.craft.add(new THREE.Mesh(GEOMETRY.droneHull, this.body), canopy);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const arm = new THREE.Mesh(GEOMETRY.droneArm, MATERIAL.dark);
      arm.rotation.y = a;
      const rotor = new THREE.Mesh(GEOMETRY.droneRotor, MATERIAL.rotor);
      rotor.position.set(Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75);
      this.craft.add(arm, rotor);
      this.rotors.push(rotor);
    }
    this.craft.scale.setScalar(SCALE);
    this.stalk = new THREE.Line(GEOMETRY.altitudeStalk, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
    this.group.add(this.craft, this.stalk);

    this.footprint = new THREE.Mesh(GEOMETRY.sensorDisc, overlayMaterial(color, 0.14));
    this.footprint.renderOrder = 3;
    this.path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.85 }));
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 }));
    parent.add(this.group, this.footprint, this.path, this.trail);
  }

  update(d: DroneView, ctx: ActorContext, time: number, dt: number) {
    const { heights, flightUnits } = ctx;
    const down = d.status === "DISABLED";
    const docked = d.dockedTruck !== null;
    const truck = docked ? ctx.trucks.get(d.dockedTruck!) : undefined;
    const x = truck?.x ?? d.x;
    const y = truck?.y ?? d.y;
    const ground = heights.groundAt(x, y);

    // Ease toward the target height: on a truck's pad, on the ground when down, or cruising.
    const target = down ? heights.surfaceAt(x, y) + 0.15 : docked ? ground + TRUCK_ROOF + 0.12 : ground + flightUnits + Math.sin(time * 2.4 + d.id) * BOB;
    this.altitude = this.altitude === null ? target : this.altitude + (target - this.altitude) * Math.min(1, dt * (docked ? 5 : 3));

    this.group.position.set(x, this.altitude, y);
    this.group.rotation.y = -d.heading;
    this.craft.rotation.z = down ? 0.6 : 0; // crashed: tilted
    if (!down && !docked) for (const r of this.rotors) r.rotation.y += dt * ROTOR_SPEED;
    if (down !== this.wasDown) {
      this.wasDown = down;
      this.body.color.setHex(down ? DOWN_COLOR : droneColor(this.id));
    }

    const airborne = !down && !docked;
    this.stalk.visible = airborne;
    this.stalk.scale.y = Math.max(0.01, this.altitude - ground);
    this.footprint.visible = airborne && ctx.showSensors;
    this.footprint.position.set(x, ground + 0.12, y);
    this.footprint.scale.setScalar(d.sensorRange);
    this.updatePath(d, ctx, airborne);
    this.updateTrail(d, ctx);
  }

  dispose() {
    for (const o of [this.group, this.footprint, this.path, this.trail]) disposeObject(o);
  }

  private updatePath(d: DroneView, ctx: ActorContext, airborne: boolean) {
    const show = airborne && ctx.showPaths;
    const key = `${show}:${d.path.length}:${d.path[0]?.x ?? 0}:${d.path[0]?.y ?? 0}`;
    if (key !== this.pathKey) {
      this.pathKey = key;
      const pts = show ? [{ x: d.x, y: d.y }, ...d.path] : [];
      setLinePoints(this.path, pts.map((p) => new THREE.Vector3(p.x, ctx.heights.groundAt(p.x, p.y) + ctx.flightUnits, p.y)));
      this.path.computeLineDistances();
    } else if (show && d.path.length) {
      // Keep the first segment glued to the drone between path changes.
      const pos = this.path.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (pos && pos.count > 0) {
        pos.setXYZ(0, d.x, this.altitude ?? 0, d.y);
        pos.needsUpdate = true;
      }
    }
  }

  private updateTrail(d: DroneView, ctx: ActorContext) {
    const last = d.trail[d.trail.length - 1];
    const key = `${ctx.showPaths}:${d.trail.length}:${last?.x ?? 0}:${last?.y ?? 0}`; // the trail is capped, so key on its end too
    if (key === this.trailKey) return;
    this.trailKey = key;
    const pts = ctx.showPaths ? d.trail.slice(-TRAIL_POINTS) : [];
    setLinePoints(this.trail, pts.map((p) => new THREE.Vector3(p.x, ctx.heights.groundAt(p.x, p.y) + ctx.flightUnits * 0.98, p.y)));
  }
}
