import { describe, expect, it } from 'vitest';
import { allocate, type AllocDrone, type AllocParams, type AllocTask } from './allocation';
import { DEFAULT_CONFIG, DEFAULT_WEIGHTS } from './defaults';
import { Simulation } from './Simulation';
import { makeTestWorld } from './testWorld';

const params = (over: Partial<AllocParams> = {}): AllocParams => ({
  weights: DEFAULT_WEIGHTS,
  diag: 200,
  capacity: 500,
  homes: [{ x: 0, y: 0 }],
  hysteresis: 0.15,
  releasedBonus: 0.1,
  spread: 25,
  margin: 10,
  ...over,
});
const drone = (id: number, x: number, y: number, battery = 500, task: number | null = null): AllocDrone => ({
  id,
  x,
  y,
  battery,
  task,
  commitment: 0,
});
const task = (id: number, cx: number, cy: number, priority: number): AllocTask => ({
  id,
  cx,
  cy,
  priority,
  searchCost: 10,
  released: false,
});

describe('allocation', () => {
  it('assigns each drone a distinct task', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task(i, 10 + i * 12, 10, 1 - i * 0.05));
    const res = allocate([drone(1, 0, 0), drone(2, 0, 0), drone(3, 0, 0)], tasks, params());
    expect(res).toHaveLength(3);
    expect(new Set(res.map((r) => r.taskId)).size).toBe(3);
  });

  it('spreads drones out: redundancy pushes the second drone away from the first', () => {
    const tasks = [task(1, 50, 50, 1), task(2, 55, 50, 0.95), task(3, 50, 140, 0.9)];
    const w = { ...DEFAULT_WEIGHTS, distance: 0, battery: 0, redundancy: 1 };
    const res = allocate([drone(1, 0, 0), drone(2, 0, 0)], tasks, params({ weights: w }));
    expect(res.map((r) => r.taskId).sort()).toEqual([1, 3]);
    // With no redundancy cost they would cluster.
    const clustered = allocate([drone(1, 0, 0), drone(2, 0, 0)], tasks, params({ weights: { ...w, redundancy: 0 } }));
    expect(clustered.map((r) => r.taskId).sort()).toEqual([1, 2]);
  });

  it('excludes tasks the drone cannot reach and return from', () => {
    const res = allocate([drone(1, 0, 0, 90)], [task(1, 150, 150, 1), task(2, 15, 15, 0.3)], params());
    expect(res).toEqual([expect.objectContaining({ droneId: 1, taskId: 2 })]);
    expect(allocate([drone(1, 0, 0, 5)], [task(1, 150, 150, 1)], params())).toEqual([]);
  });

  it('hysteresis keeps the current task against a marginally better one', () => {
    const tasks = [task(1, 40, 40, 0.9), task(2, 40, 44, 1)];
    expect(allocate([drone(1, 40, 42, 500, 1)], tasks, params())[0].taskId).toBe(1);
    expect(allocate([drone(1, 40, 42, 500, null)], tasks, params())[0].taskId).toBe(2);
  });

  it('the simulation tasks every drone to a different sector at deployment', () => {
    const sim = new Simulation(makeTestWorld(), { ...structuredClone(DEFAULT_CONFIG), droneCount: 5 });
    const ids = sim.state.drones.map((d) => d.taskId);
    expect(ids.every((t) => t !== null)).toBe(true);
    expect(new Set(ids).size).toBe(5);
    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'assign')).toHaveLength(5);
    expect(events.find((e) => e.type === 'assign')!.message).toMatch(/Drone \d → .+ \(priority \d\.\d\d: .* km\)/);
    for (const d of sim.state.drones) expect(sim.state.tasks.find((t) => t.id === d.taskId)!.assignedDrone).toBe(d.id);
  });
});
