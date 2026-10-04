// Text for the decision feed. Kept apart from the logic so wording can change without touching
// the engine (the golden-trace test pins the current wording).

const km = (cells: number, cellSizeM: number) => ((cells * cellSizeM) / 1000).toFixed(1);

export const messages = {
  droneDown: (drone: number, block: string | null) =>
    `Drone ${drone} went down${block ? ` — ${block} handed back to the fleet` : ""}`,

  crowdReported: (people: number, place: string) => `Crowd of ~${people} reported near ${place}`,

  truckMoving: (truck: number, cells: number, cellSizeM: number, place: string) =>
    `Truck ${truck} driving ${km(cells, cellSizeM)} km to ${place} — closer to where the drones are working`,

  recharged: (drone: number, truck: number) => `Drone ${drone} recharged on Truck ${truck} — ready to launch`,

  lowBattery: (drone: number, batteryPct: number, truck: number, block: string | null) =>
    `Drone ${drone} at ${batteryPct}% battery — flying to Truck ${truck} to recharge${block ? `, ${block} handed back` : ""}`,

  survivorFound: (drone: number, place: string) =>
    `Survivor found by Drone ${drone} near ${place} — checking the surrounding blocks next`,

  blockFinished: (drone: number, block: string, pct: number, exhausted: boolean) =>
    exhausted
      ? `Drone ${drone} finished ${block} (${pct}% searched, rest unreachable)`
      : `Drone ${drone} finished ${block} (${pct}% searched)`,

  tsunamiImpact: (areaKm2: string, runupM: number, lost: number, foundInTime: number) =>
    `TSUNAMI IMPACT — ${areaKm2} km² below ${runupM} m flooded; ${lost} unfound survivor(s) lost, ${foundInTime} found in time`,

  replanned: (reasons: string[], changed: number, candidates: number) =>
    `Replanned (${reasons.join("; ")}): ${
      changed ? `${changed} drone${changed === 1 ? "" : "s"} re-tasked` : `${candidates} blocks re-scored, plan unchanged`
    }`,

  nothingInRange: (drone: number) => `Drone ${drone} has nothing worthwhile in range — landing on the nearest truck`,

  assignment: (drone: number, block: string, priority: number, reasons: string[], cells: number, cellSizeM: number) =>
    `Drone ${drone} → ${block} (priority ${priority.toFixed(2)}: ${[...reasons, `${km(cells, cellSizeM)} km`].join(", ")})`,

  takingOver: (from: number) => ` — taking over from Drone ${from}`,
  switchingFrom: (block: string) => ` — switching from ${block}`,

  missionComplete: (seconds: number, areaPct: number, found: number, total: number, lost: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return (
      `Search complete in ${mins}m${String(secs).padStart(2, "0")}s — ${areaPct}% of area covered, ` +
      `${found}/${total} survivors found${lost ? `, ${lost} lost` : ""}`
    );
  },
};
