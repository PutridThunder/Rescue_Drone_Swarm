// DeepSearch: POST /api/deepsearch
//
// Asks Gemini (with Google Search grounding) how the drone fleet should prioritise a mission,
// given the area, the disaster scenario and the operator's description. Returns seven weights
// in 0..1 (0.5 = normal priority), a short rationale and the web sources Gemini used.
//
// Runs on the server only (a Vercel function, and the Vite dev server via
// server/deepsearch/vitePlugin.ts), so the API key never reaches the browser.
// Environment: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default below).
//
// Self-contained on purpose (no local imports) so Vercel can bundle it as is.

const DEFAULT_MODEL = "gemini-3.8-flash";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_DESCRIPTION = 600;
const TIMEOUT_MS = 45_000;

export const WEIGHT_KEYS = ["population", "hazard", "urgency", "unsearched_area", "distance_cost", "battery_cost", "avoid_overlap"] as const;
export type DeepSearchWeightKey = (typeof WEIGHT_KEYS)[number];

export interface DeepSearchRequest {
  area: string; // e.g. "Lonsdale, North Vancouver"
  lat: number;
  lon: number;
  scenario: "none" | "tsunami";
  coastal: boolean;
  description: string; // operator's words, may be empty
  localTime: string; // ISO time of the disaster in the simulation
}

export interface DeepSearchResult {
  weights: Record<DeepSearchWeightKey, number>; // 0..1, 0.5 = normal
  reasons: Partial<Record<DeepSearchWeightKey, string>>;
  summary: string;
  sources: { title: string; url: string }[];
  model: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Vercel function entry point (Web-standard Request/Response). */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseRequest(await request.json().catch(() => null));
    const result = await runDeepSearch(input, process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL);
    return json(200, result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    return json(status, { error: (err as Error).message });
  }
}

export async function runDeepSearch(input: DeepSearchRequest, apiKey: string | undefined, model = DEFAULT_MODEL): Promise<DeepSearchResult> {
  if (!apiKey) throw new HttpError(503, "DeepSearch is not configured: set GEMINI_API_KEY on the server.");
  const res = await fetch(`${GEMINI_URL}/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
      tools: [{ google_search: {} }], // grounding: Gemini searches the web for current conditions
      generationConfig: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new HttpError(502, `Gemini error ${res.status}: ${detail?.error?.message ?? res.statusText}`);
  }
  const body = (await res.json()) as GeminiResponse;
  const candidate = body.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return { ...parseAnswer(text), sources: sourcesOf(candidate), model: model || DEFAULT_MODEL };
}

export function buildPrompt(r: DeepSearchRequest): string {
  const scenario = r.scenario === "tsunami" ? "tsunami warning (the wave reaches the waterfront within minutes)" : "search and rescue after a disaster";
  return `You are DeepSearch, the mission-priority advisor for an autonomous search-and-rescue drone fleet.

Mission
- Area: ${r.area} (centre ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}), about 2.5 x 2.1 km of city blocks
- Coastline in the area: ${r.coastal ? "yes" : "no"}
- Scenario: ${scenario}
- Time of the disaster: ${r.localTime}
- Operator notes: ${r.description || "(none)"}

Use Google Search for what matters right now at this place and time: how many people are
likely there (residential density, events, transit, schools, nightlife), local hazards
(flood or tsunami zones, landslide, fire, current alerts or weather), and access constraints.

Then weight these factors for the drones' search planner. Each weight is a number from 0.0 to
1.0 with one decimal; 0.5 means "normal priority", 1.0 "twice as important", 0.0 "ignore":
- population: search where people are likely to be first
- hazard: favour cells in known hazard zones
- urgency: favour areas that will become unreachable soon (e.g. the flood zone before impact)
- unsearched_area: favour large unexplored areas (fast coverage)
- distance_cost: avoid long flights between blocks
- battery_cost: avoid assignments that drain batteries
- avoid_overlap: keep drones spread apart

Reply with JSON only, no markdown, exactly this shape:
{"summary": "<two sentences on the situation and the main priority>",
 "weights": {"population": 0.0, "hazard": 0.0, "urgency": 0.0, "unsearched_area": 0.0, "distance_cost": 0.0, "battery_cost": 0.0, "avoid_overlap": 0.0},
 "reasons": {"<factor>": "<one short reason>", "...": "..."}}`;
}

/** Pull the JSON object out of Gemini's text and validate it. */
export function parseAnswer(text: string): Omit<DeepSearchResult, "sources" | "model"> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HttpError(502, "Gemini did not return JSON");
  let raw: { summary?: unknown; weights?: Record<string, unknown>; reasons?: Record<string, unknown> };
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "Gemini returned malformed JSON");
  }
  const weights = {} as Record<DeepSearchWeightKey, number>;
  const reasons: Partial<Record<DeepSearchWeightKey, string>> = {};
  for (const k of WEIGHT_KEYS) {
    const v = Number(raw.weights?.[k]);
    if (!Number.isFinite(v)) throw new HttpError(502, `Gemini left out the "${k}" weight`);
    weights[k] = Math.round(Math.min(1, Math.max(0, v)) * 10) / 10;
    const why = raw.reasons?.[k];
    if (typeof why === "string" && why.trim()) reasons[k] = why.trim().slice(0, 200);
  }
  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 600) : "";
  return { weights, reasons, summary };
}

export function parseRequest(body: unknown): DeepSearchRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, "lat/lon required");
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return {
    area: text(b.area, 80) || "the target area",
    lat,
    lon,
    scenario: b.scenario === "tsunami" ? "tsunami" : "none",
    coastal: b.coastal === true,
    description: text(b.description, MAX_DESCRIPTION),
    localTime: text(b.localTime, 40) || new Date().toISOString(),
  };
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

function sourcesOf(c: GeminiCandidate | undefined): DeepSearchResult["sources"] {
  const seen = new Set<string>();
  const out: DeepSearchResult["sources"] = [];
  for (const chunk of c?.groundingMetadata?.groundingChunks ?? []) {
    const url = chunk.web?.uri;
    if (!url || !/^https:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: (chunk.web?.title ?? new URL(url).hostname).slice(0, 100), url });
  }
  return out.slice(0, 6);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
