// Everything that moves or is placed: drones, trucks, survivors and crowds, kept in sync with
// the simulation state each frame. Rebuilt (and freed) when a new mission starts.

import * as THREE from "three";
import type { CrowdView, SimState, SurvivorView } from "../../../types";
import type { HeightField } from "../city/HeightField";
import { CrowdMarker } from "./CrowdMarker";
import { DroneActor } from "./DroneActor";
import type { ActorContext } from "./shared";
import { SurvivorMarker } from "./SurvivorMarker";
import { TruckActor } from "./TruckActor";

export class ActorLayer {
  readonly group = new THREE.Group();
  showPaths = true;
  showSensors = true;
  revealHidden = false;
  private drones = new Map<number, DroneActor>();
  private trucks = new Map<number, TruckActor>();
  private survivors = new Map<SurvivorView, SurvivorMarker>();
  private crowds = new Map<CrowdView, CrowdMarker>();
  private stateRef: SimState | null = null;

  constructor(
    private readonly heights: HeightField,
    offset: THREE.Vector3,
  ) {
    this.group.position.copy(offset);
  }

  update(state: SimState, time: number, dt: number) {
    if (state !== this.stateRef) this.reset(state);
    const ctx: ActorContext = {
      heights: this.heights,
      flightUnits: this.heights.units(state.config.flightAltitudeM),
      trucks: new Map(state.trucks.map((t) => [t.id, t])),
      showPaths: this.showPaths,
      showSensors: this.showSensors,
      revealHidden: this.revealHidden,
    };
    for (const t of state.trucks) this.getOrCreate(this.trucks, t.id, () => new TruckActor(t.id, this.group)).update(t, ctx, dt);
    for (const d of state.drones) this.getOrCreate(this.drones, d.id, () => new DroneActor(d.id, this.group)).update(d, ctx, time, dt);

    this.sync(state.survivors, this.survivors, (s) => new SurvivorMarker(s, ctx));
    for (const m of this.survivors.values()) m.update(ctx, time);
    this.sync(state.crowds, this.crowds, (c) => new CrowdMarker(c, ctx));
    // Predicted crowds only show while the fleet is using crowd intel.
    for (const m of this.crowds.values()) m.setShown(m.crowd.source === "user" || state.config.info.crowds);
  }

  /** World position and heading of a drone (for the follow camera and drone cam). */
  dronePose(id: number, out: THREE.Vector3): number | null {
    const a = this.drones.get(id);
    if (!a) return null;
    a.group.getWorldPosition(out);
    return -a.group.rotation.y;
  }

  dronesWorld(): { id: number; pos: THREE.Vector3 }[] {
    return [...this.drones.values()].map((a) => ({ id: a.id, pos: a.group.getWorldPosition(new THREE.Vector3()) }));
  }

  private getOrCreate<K, V>(map: Map<K, V>, key: K, make: () => V): V {
    let v = map.get(key);
    if (!v) map.set(key, (v = make()));
    return v;
  }

  /** Add markers for new items and free markers whose item is gone. */
  private sync<K extends object, M extends { group: THREE.Group; dispose(): void }>(items: K[], map: Map<K, M>, make: (k: K) => M) {
    const live = new Set(items);
    for (const [k, m] of map) {
      if (!live.has(k)) {
        m.dispose();
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
    for (const map of [this.drones, this.trucks, this.survivors, this.crowds] as Map<unknown, { dispose(): void }>[]) {
      for (const a of map.values()) a.dispose();
      map.clear();
    }
  }
}
