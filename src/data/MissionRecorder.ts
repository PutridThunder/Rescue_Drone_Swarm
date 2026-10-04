// Samples a running mission every few simulated seconds (for the timeline chart in Snowflake)
// and turns a finished one into a MissionRecord.

import type { SimState } from "../types";
import type { MissionRecord } from "./records";

const SAMPLE_EVERY_S = 10;

export class MissionRecorder {
  private timeline: [number, number, number][] = [];
  private nextAt = 0;

  reset() {
    this.timeline = [];
    this.nextAt = 0;
  }

  /** Call every frame with the live state. */
  sample(state: SimState) {
    if (state.time < this.nextAt) return;
    this.nextAt = state.time + SAMPLE_EVERY_S;
    this.timeline.push([Math.round(state.time), round(state.metrics.areaSearchedFrac), state.metrics.survivorsFound]);
  }

  finish(state: SimState, area: string, cellSizeM: number): MissionRecord {
    const m = state.metrics;
    const c = state.config;
    this.timeline.push([Math.round(state.time), round(m.areaSearchedFrac), m.survivorsFound]);
    return {
      area,
      scenario: c.scenario,
      drones: c.droneCount,
      trucks: c.truckCount,
      streetMap: c.info.geography,
      searchRadiusM: c.searchArea ? Math.round(c.searchArea.r * cellSizeM) : null,
      seed: c.seed,
      survivorsTotal: m.survivorsTotal,
      survivorsFound: m.survivorsFound,
      survivorsLost: m.survivorsLost,
      durationS: Math.round(m.time * 10) / 10,
      areaSearched: round(m.areaSearchedFrac),
      redundancy: round(m.redundancyFrac),
      distanceKm: Math.round(((m.distanceTravelled * cellSizeM) / 1000) * 100) / 100,
      batteryUsed: Math.round(m.batteryConsumed * 100) / 100,
      failures: m.droneFailures,
      timeline: this.timeline,
    };
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
