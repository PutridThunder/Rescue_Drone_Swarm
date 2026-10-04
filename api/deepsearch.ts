// DeepSearch: POST /api/deepsearch
//
// Asks Gemini how the drone fleet should prioritise a mission, given the area, the disaster
// scenario and the operator's notes. Returns seven weights in 0..1 (0.5 = normal priority), a
// one-line rationale, and (with web search on) the sources Gemini used.
//
// Built to fit the Gemini free tier and use few tokens:
//   - web search (Google Search grounding) only when asked: it adds thousands of input tokens
//     and has its own small free quota; without it the answer comes as schema-checked JSON
//   - low thinking, a short prompt and a capped, short answer
//   - identical requests within an hour are answered from a cache (also cached in the browser)
//   - a per-visitor cool-down and a global minimum gap, to stay under free per-minute limits
//   - GEMINI_MODEL may list several models ("a,b"): the next is tried if one is out of quota
//
// Runs on the server only (a Vercel function, and the Vite dev server via
// server/deepsearch/vitePlugin.ts), so the API key never reaches the browser.
// Environment: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default below).
//
// Self-contained on purpose (no local imports) so Vercel can bundle it as is.

const DEFAULT_MODEL = "gemini-3.8-flash";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_DESCRIPTION = 300;
const TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 800; // room for low thinking + a ~150-token answer
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX = 200;
const VISITOR_COOLDOWN_MS = 15_000; // per IP, between calls that reach Gemini
const GLOBAL_GAP_MS = 4_000; // between any two calls that reach Gemini (free tiers allow ~10-15/min)

export const WEIGHT_KEYS = ["population", "hazard", "urgency", "unsearched_area", "distance_cost", "battery_cost", "avoid_overlap"] as const;
export type DeepSearchWeightKey = (typeof WEIGHT_KEYS)[number];

export interface DeepSearchRequest {
  area: string; // e.g. "Lonsdale, North Vancouver"
  lat: number;
  lon: number;
  scenario: "none" | "tsunami";
  coastal: boolean;
  description: string; // operator's words, may be empty
  localTime: string; // disaster time, rounded to the hour (keeps requests cacheable)
  webSearch: boolean; // ground the answer in Google Search (more tokens and quota)
}

export interface DeepSearchResult {
  weights: Record<DeepSearchWeightKey, number>; // 0..1, 0.5 = normal
  reasons: Partial<Record<DeepSearchWeightKey, string>>;
  summary: string;
  sources: { title: string; url: string }[];
  model: string;
  tokens: number | null; // total tokens Gemini billed for this answer (null when cached)
  cached: boolean;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server environment, read without needing Node's type definitions (see api/tsconfig.json). */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const cache = new Map<string, { at: number; result: DeepSearchResult }>();
const lastCallByVisitor = new Map<string, number>();
let lastCall = 0;

/** Vercel function entry point (Web-standard Request/Response). */
export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseRequest(await request.json().catch(() => null));
    const key = JSON.stringify(input);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json(200, { ...hit.result, tokens: null, cached: true });

    if (!env.GEMINI_API_KEY) throw new HttpError(503, "DeepSearch is not configured: set GEMINI_API_KEY on the server.");
    throttle(request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local");
    const result = await runDeepSearch(input, env.GEMINI_API_KEY, env.GEMINI_MODEL);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), result });
    return json(200, result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    return json(status, { error: (err as Error).message });
  }
}

/** Refuse calls that would come too fast for the free tier (cached answers are never throttled). */
function throttle(visitor: string) {
  const now = Date.now();
  const wait = Math.max((lastCallByVisitor.get(visitor) ?? 0) + VISITOR_COOLDOWN_MS - now, lastCall + GLOBAL_GAP_MS - now);
  if (wait > 0) throw new HttpError(429, `Please wait ${Math.ceil(wait / 1000)} s before the next DeepSearch.`);
  lastCallByVisitor.set(visitor, now);
  lastCall = now;
  if (lastCallByVisitor.size > 1000) lastCallByVisitor.clear();
}

export async function runDeepSearch(input: DeepSearchRequest, apiKey: string | undefined, models = DEFAULT_MODEL): Promise<DeepSearchResult> {
  if (!apiKey) throw new HttpError(503, "DeepSearch is not configured: set GEMINI_API_KEY on the server.");
  const list = (models || DEFAULT_MODEL).split(",").map((m) => m.trim()).filter(Boolean);
  let lastError: HttpError | null = null;
  for (const model of list) {
    try {
      return await callModel(model, input, apiKey);
    } catch (err) {
      // Out of quota (429) or not offered to this key (404): try the next model, if any.
      if (err instanceof HttpError && (err.status === 429 || err.status === 404)) lastError = err;
      else throw err;
    }
  }
  throw lastError!;
}

async function callModel(model: string, input: DeepSearchRequest, apiKey: string, thinking = true): Promise<DeepSearchResult> {
  const generationConfig: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS };
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  if (!input.webSearch) {
    // Without tools Gemini can return schema-checked JSON directly (no prose to strip).
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = RESPONSE_SCHEMA;
  }
  const res = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
      ...(input.webSearch ? { tools: [{ google_search: {} }] } : {}),
      generationConfig,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const message = detail?.error?.message ?? res.statusText;
    // Older models don't take thinkingLevel: ask again without it (a 400 costs no quota).
    if (res.status === 400 && thinking && /thinking/i.test(message)) return callModel(model, input, apiKey, false);
    if (res.status === 429) {
      throw new HttpError(429, `Gemini free-tier quota reached for ${model} (per minute or per day). Try again in a minute or tomorrow; usage: https://ai.dev/rate-limit`);
    }
    throw new HttpError(res.status === 404 ? 404 : 502, `Gemini error ${res.status}: ${message}`);
  }
  const body = (await res.json()) as GeminiResponse;
  const candidate = body.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return { ...parseAnswer(text), sources: sourcesOf(candidate), model, tokens: body.usageMetadata?.totalTokenCount ?? null, cached: false };
}

/** Short on purpose: every word is paid for on every call. */
export function buildPrompt(r: DeepSearchRequest): string {
  const scenario = r.scenario === "tsunami" ? "tsunami warning, wave hits the waterfront in minutes" : "search and rescue after a disaster";
  return [
    `Drone search-and-rescue mission. Area: ${r.area} (${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}), 2.5x2.1 km of city, coastline: ${r.coastal ? "yes" : "no"}.`,
    `Scenario: ${scenario}. Time: ${r.localTime}.${r.description ? ` Notes: ${r.description}` : ""}`,
    r.webSearch ? "Search the web for current events, crowds, hazards or alerts at this place and time." : "",
    "Rate each search-planner factor 0.0-1.0 (0.5 normal, 1 double, 0 ignore): population (where people likely are), hazard (danger zones), urgency (areas soon unreachable, e.g. flood zone before impact), unsearched_area (fast coverage), distance_cost (avoid long flights), battery_cost (save battery), avoid_overlap (spread drones).",
    'JSON only: {"summary":"<max 25 words>","weights":{"population":0.5,"hazard":0.5,"urgency":0.5,"unsearched_area":0.5,"distance_cost":0.5,"battery_cost":0.5,"avoid_overlap":0.5},"reasons":{"<factor>":"<max 8 words>"}} with reasons only for the 2-3 factors furthest from 0.5.',
  ]
    .filter(Boolean)
    .join("\n");
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    weights: { type: "OBJECT", properties: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, { type: "NUMBER" }])), required: [...WEIGHT_KEYS] },
    reasons: { type: "OBJECT", properties: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, { type: "STRING" }])) },
  },
  required: ["summary", "weights"],
};

/** Pull the JSON object out of Gemini's text and validate it. */
export function parseAnswer(text: string): Pick<DeepSearchResult, "weights" | "reasons" | "summary"> {
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
    if (typeof why === "string" && why.trim()) reasons[k] = why.trim().slice(0, 120);
  }
  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 300) : "";
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
    localTime: text(b.localTime, 40) || new Date().toISOString().slice(0, 13),
    webSearch: b.webSearch === true,
  };
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: { totalTokenCount?: number };
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
