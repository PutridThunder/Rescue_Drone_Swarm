// How full a place typically is at a given local time (0 = empty, 1 = at capacity).
// Simple, explainable daily profiles per place type; tweak the tables below to tune.

type Ranges = [from: number, to: number, level: number][]; // hours [from, to) in local time

interface Profile {
  weekday: Ranges;
  weekend: Ranges;
  label: string; // human explanation used in hotspot reasoning
}

const PROFILES: Record<string, Profile> = {
  school: {
    weekday: [[7, 8, 0.3], [8, 15, 0.95], [15, 17, 0.3]],
    weekend: [[9, 15, 0.05]],
    label: "school day",
  },
  kindergarten: { weekday: [[7, 18, 0.9]], weekend: [], label: "daycare hours" },
  college: { weekday: [[8, 12, 0.7], [12, 17, 0.8], [17, 21, 0.4]], weekend: [[10, 16, 0.15]], label: "classes in session" },
  hospital: { weekday: [[0, 7, 0.6], [7, 21, 0.9], [21, 24, 0.65]], weekend: [[0, 24, 0.7]], label: "patients, staff and visitors" },
  clinic: { weekday: [[8, 18, 0.8]], weekend: [[9, 14, 0.4]], label: "clinic hours" },
  transit: {
    weekday: [[5, 7, 0.3], [7, 10, 1], [10, 15, 0.45], [15, 19, 1], [19, 23, 0.35], [23, 24, 0.1]],
    weekend: [[7, 10, 0.3], [10, 19, 0.6], [19, 24, 0.3]],
    label: "SeaBus and bus commuters",
  },
  market: { weekday: [[9, 12, 0.5], [12, 14, 0.8], [14, 19, 0.6]], weekend: [[9, 11, 0.6], [11, 17, 1], [17, 19, 0.5]], label: "shoppers" },
  dining: {
    weekday: [[7, 10, 0.35], [11, 14, 0.75], [14, 17, 0.3], [17, 21, 0.9], [21, 24, 0.4]],
    weekend: [[9, 14, 0.8], [14, 17, 0.5], [17, 22, 1], [22, 24, 0.5]],
    label: "diners",
  },
  nightlife: { weekday: [[20, 24, 0.5], [0, 1, 0.3]], weekend: [[20, 24, 1], [0, 2, 0.7]], label: "nightlife" },
  venue: { weekday: [[10, 17, 0.35], [18, 22, 0.7]], weekend: [[10, 17, 0.6], [18, 22, 0.8]], label: "visitors" },
  worship: { weekday: [[18, 20, 0.15]], weekend: [[9, 13, 0.85], [17, 19, 0.3]], label: "services" },
  community: { weekday: [[9, 21, 0.6]], weekend: [[9, 18, 0.7]], label: "programs and classes" },
  park: { weekday: [[7, 10, 0.25], [10, 16, 0.4], [16, 20, 0.6]], weekend: [[9, 19, 0.85]], label: "park visitors" },
  hotel: { weekday: [[0, 8, 0.85], [8, 17, 0.35], [17, 24, 0.7]], weekend: [[0, 10, 0.9], [10, 17, 0.45], [17, 24, 0.8]], label: "hotel guests" },
};

// OSM type -> profile name (types not listed use their hotspot kind).
const TYPE_PROFILE: Record<string, string> = {
  college: "college",
  university: "college",
  kindergarten: "kindergarten",
  hospital: "hospital",
  clinic: "clinic",
  nightclub: "nightlife",
  pub: "nightlife",
  bar: "nightlife",
};

const SCHOOL_TYPES = new Set(["school", "kindergarten", "college", "university"]);

export interface LocalTime {
  dayOfWeek: number; // 0 = Sunday
  hour: number; // fractional, e.g. 14.5
  month: number; // 1..12
  label: string; // e.g. "Saturday 2:30 p.m."
}

/** Wall-clock time in Vancouver for a timestamp. */
export function vancouverTime(at: Date): LocalTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    month: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const label = at.toLocaleString("en-CA", { timeZone: "America/Vancouver", weekday: "long", hour: "numeric", minute: "2-digit" });
  return { dayOfWeek: days.indexOf(get("weekday")), hour: Number(get("hour")) + Number(get("minute")) / 60, month: Number(get("month")), label };
}

/** Occupancy (0..1) of a place of this OSM type / kind at this local time, plus a short reason. */
export function occupancy(type: string, kind: string, t: LocalTime, name = ""): { level: number; reason: string } {
  // Seasonal places named after Christmas only run mid-November to December.
  if (/christmas|holiday market/i.test(name) && t.month !== 11 && t.month !== 12) return { level: 0, reason: "out of season" };
  const profile = PROFILES[TYPE_PROFILE[type] ?? type] ?? PROFILES[kind];
  if (!profile) return { level: 0.2, reason: "typical activity" };
  const weekend = t.dayOfWeek === 0 || t.dayOfWeek === 6;
  // BC schools are out in July and August.
  if (SCHOOL_TYPES.has(type) && type !== "kindergarten" && (t.month === 7 || t.month === 8)) {
    return { level: 0.05, reason: "summer break" };
  }
  const ranges = weekend ? profile.weekend : profile.weekday;
  let level = 0.05;
  for (const [from, to, v] of ranges) if (t.hour >= from && t.hour < to) level = v;
  return { level, reason: level >= 0.5 ? profile.label : `quiet hours (${profile.label})` };
}
