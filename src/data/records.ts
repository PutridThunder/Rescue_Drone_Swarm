// Snowflake storage client: sends finished missions and challenge games to /api/snowflake and
// reads the History summary back. Optional: if the server has no Snowflake set up (or is
// offline) every call quietly does nothing and the app works as before.

import type { History } from "../../api/snowflake";

export type { History };

export interface MissionRecord {
  area: string;
  scenario: string;
  drones: number;
  trucks: number;
  streetMap: boolean;
  searchRadiusM: number | null;
  seed: number;
  survivorsTotal: number;
  survivorsFound: number;
  survivorsLost: number;
  durationS: number;
  areaSearched: number;
  redundancy: number;
  distanceKm: number;
  batteryUsed: number;
  failures: number;
  /** [seconds, share of area searched, survivors found] every few seconds */
  timeline: [number, number, number][];
}

export interface GameRecord {
  area: string;
  survivorsTotal: number;
  humanFound: number;
  humanHectares: number;
  aiFound: number;
  aiHectares: number;
  winner: "human" | "algorithm" | "tie";
  durationS: number;
}

/** True if the row was stored. Never throws. */
export async function saveRecord(kind: "mission" | "game", record: MissionRecord | GameRecord): Promise<boolean> {
  try {
    const res = await fetch("/api/snowflake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...record }) });
    return res.ok;
  } catch {
    return false;
  }
}

/** The History summary, or null when Snowflake isn't available. Never throws. */
export async function loadHistory(): Promise<History | null> {
  try {
    const res = await fetch("/api/snowflake");
    return res.ok ? ((await res.json()) as History) : null;
  } catch {
    return null;
  }
}
