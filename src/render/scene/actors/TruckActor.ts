// A charging truck with a landing pad on the roof, plus its dashed route while driving.

import * as THREE from "three";
import type { TruckView } from "../../../types";
import { disposeObject, GEOMETRY, MATERIAL, TRUCK_ROOF, type ActorContext, setLinePoints } from "./shared";

const WHEELS: [number, number][] = [
  [0.6, 0.36],
  [0.6, -0.36],
  [-0.55, 0.36],
  [-0.55, -0.36],
];

export class TruckActor {
  readonly group = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly route: THREE.Line;
  private routeKey = "";

  constructor(
    readonly id: number,
    parent: THREE.Group,
  ) {
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      return m;
    };
    this.group.add(
      part(GEOMETRY.truckBody, MATERIAL.truckBody, -0.15, 0.25),
      part(GEOMETRY.truckCab, MATERIAL.truckCab, 0.78, 0.23),
      part(GEOMETRY.truckStripe, MATERIAL.truckAccent, -0.15, 0.2),
      part(GEOMETRY.truckPad, MATERIAL.truckAccent, -0.15, TRUCK_ROOF + 0.01),
      part(GEOMETRY.truckPadInner, MATERIAL.white, -0.15, TRUCK_ROOF + 0.01),
    );
    for (const [x, z] of WHEELS) {
      const w = part(GEOMETRY.truckWheel, MATERIAL.dark, x, 0.12, z);
      this.group.add(w);
      this.wheels.push(w);
    }
    this.route = new THREE.Line(new THREE.BufferGeometry(), MATERIAL.truckRoute);
    parent.add(this.group, this.route);
  }

  update(t: TruckView, ctx: ActorContext, dt: number) {
    this.group.position.set(t.x, ctx.heights.groundAt(t.x, t.y) + 0.02, t.y);
    this.group.rotation.y = -t.heading;
    if (t.status === "DRIVING") for (const w of this.wheels) w.rotation.z -= dt * 8;
    const key = `${ctx.showPaths}:${t.path.length}:${t.path[t.path.length - 1]?.x ?? 0}`;
    if (key === this.routeKey) return;
    this.routeKey = key;
    const pts = ctx.showPaths ? [{ x: t.x, y: t.y }, ...t.path] : [];
    setLinePoints(this.route, pts.map((p) => new THREE.Vector3(p.x, ctx.heights.groundAt(p.x, p.y) + 0.12, p.y)));
    this.route.computeLineDistances();
  }

  dispose() {
    disposeObject(this.group);
    disposeObject(this.route);
  }
}
