import type { Metrics } from '../types';

export function createMetrics(survivorsTotal: number, populationTotal: number): Metrics {
  return {
    time: 0,
    areaSearchedFrac: 0,
    survivorsFound: 0,
    survivorsTotal,
    survivorsLost: 0,
    populationReached: 0,
    populationTotal,
    droneUtilization: 0,
    redundancyFrac: 0,
    distanceTravelled: 0,
    batteryConsumed: 0,
    tasksCompleted: 0,
    tasksReassigned: 0,
    droneFailures: 0,
    complete: false,
  };
}

/** Running totals the Simulation feeds; folded into Metrics once per step. */
export class MetricsAccumulator {
  searchedCells = 0;
  searchableCells = 0;
  populationReached = 0;
  visits = 0;
  redundantVisits = 0;
  busyTime = 0;
  activeTime = 0;
  batteryCells = 0;

  apply(m: Metrics, time: number, distance: number, capacity: number) {
    m.time = time;
    m.areaSearchedFrac = this.searchableCells > 0 ? this.searchedCells / this.searchableCells : 1;
    m.populationReached = this.populationReached;
    m.redundancyFrac = this.visits > 0 ? this.redundantVisits / this.visits : 0;
    m.droneUtilization = this.activeTime > 0 ? this.busyTime / this.activeTime : 0;
    m.distanceTravelled = distance;
    m.batteryConsumed = this.batteryCells / capacity;
  }
}
