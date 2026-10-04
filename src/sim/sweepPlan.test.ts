import { describe, expect, it } from "vitest";
import { planLanes } from "./sweepPlan";

const block = { x0: 0, y0: 0, x1: 10, y1: 10 };

describe("planLanes", () => {
  it("covers a block with back-and-forth lanes from the nearest corner", () => {
    const wps = planLanes(block, 9, 9, 5, 3);
    // Two lanes (rows 2 and 7), starting on the drone's side (bottom right).
    expect(new Set(wps.map((w) => w.y))).toEqual(new Set([7, 2]));
    expect(wps[0]).toEqual({ x: 9, y: 7 });
    const lane1 = wps.filter((w) => w.y === 7).map((w) => w.x);
    const lane2 = wps.filter((w) => w.y === 2).map((w) => w.x);
    expect(lane1).toEqual([9, 6, 3, 0]);
    expect(lane2).toEqual([0, 3, 6, 9]); // serpentine: comes back the other way
  });

  it("runs lanes along the longer side", () => {
    const tall = planLanes({ x0: 0, y0: 0, x1: 4, y1: 12 }, 0, 0, 5, 4);
    expect(new Set(tall.map((w) => w.x)).size).toBe(1);
  });
});
