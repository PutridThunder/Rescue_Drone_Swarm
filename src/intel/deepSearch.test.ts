import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrompt, parseAnswer, parseRequest, POST } from "../../api/deepsearch";
import { DEFAULT_WEIGHTS } from "../sim/defaults";
import { toPlannerWeights } from "./deepSearch";

const WEIGHTS = { population: 0.9, hazard: 0.5, urgency: 1, unsearched_area: 0.5, distance_cost: 0.25, battery_cost: 0.5, avoid_overlap: 0 };
const BASE = { lat: 49.3, lon: -123.1, area: "Lonsdale" };
let clock = Date.now() + 24 * 3600_000; // ahead of real time, so the real-time retry test never blocks the others
const request = (body: unknown, ip = "1.1.1.1") =>
  new Request("http://x/api/deepsearch", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": ip } });
const geminiReply = (status = 200) =>
  status === 200
    ? Response.json({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ summary: "s", weights: WEIGHTS, reasons: {} }) }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.org/a", title: "Example" } }] },
          },
        ],
        usageMetadata: { totalTokenCount: 321 },
      })
    : Response.json({ error: { message: "quota" } }, { status });

describe("DeepSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    clock += 10 * 60_000; // every test starts clear of the server's cool-downs
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("parses Gemini's JSON even with text around it, clamping and rounding weights", () => {
    const r = parseAnswer(`Here you go:\n${JSON.stringify({ summary: "Busy waterfront.", weights: { ...WEIGHTS, hazard: 1.7 }, reasons: { hazard: "flood zone" } })}`);
    expect(r.weights.hazard).toBe(1);
    expect(r.weights.distance_cost).toBe(0.3);
    expect(r.reasons.hazard).toBe("flood zone");
  });

  it("rejects answers with a missing weight", () => {
    expect(() => parseAnswer(JSON.stringify({ weights: { population: 1 } }))).toThrow(/hazard/);
  });

  it("validates and trims the request; web search is off unless asked", () => {
    expect(() => parseRequest({ lat: 200, lon: 0 })).toThrow();
    const r = parseRequest({ ...BASE, scenario: "tsunami", description: "x".repeat(2000) });
    expect(r.scenario).toBe("tsunami");
    expect(r.description.length).toBe(300);
    expect(r.webSearch).toBe(false);
  });

  it("keeps the prompt short", () => {
    const prompt = buildPrompt(parseRequest({ ...BASE, description: "concert at the arena" }));
    expect(prompt.length).toBeLessThan(1000); // ~250 tokens
  });

  it("maps 0.5 to the tuned default, 1 to double, 0 to off", () => {
    const w = toPlannerWeights(WEIGHTS);
    expect(w.urgency).toBe(DEFAULT_WEIGHTS.urgency * 2);
    expect(w.hazard).toBe(DEFAULT_WEIGHTS.hazard);
    expect(w.redundancy).toBe(0);
  });

  it("says so when the key is missing", async () => {
    const res = await POST(request(BASE));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/GEMINI_API_KEY/);
  });

  it("without web search: schema JSON, low thinking, no tools; key in a header", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => geminiReply());
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ ...BASE, description: "a" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.weights.population).toBe(0.9);
    expect(body.tokens).toBe(321);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const sent = JSON.parse(init.body as string);
    expect(sent.tools).toBeUndefined();
    expect(sent.generationConfig.responseMimeType).toBe("application/json");
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("with web search: grounding tool and sources", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => geminiReply());
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(request({ ...BASE, description: "b", webSearch: true }))).json();
    expect(body.sources).toEqual([{ title: "Example", url: "https://example.org/a" }]);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.tools).toEqual([{ google_search: {} }]);
    expect(sent.generationConfig.responseMimeType).toBeUndefined();
  });

  it("answers a repeated request from the cache, and throttles rapid new ones", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => geminiReply());
    vi.stubGlobal("fetch", fetchMock);
    await POST(request({ ...BASE, description: "c" }));
    const again = await (await POST(request({ ...BASE, description: "c" }))).json();
    expect(again.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rushed = await POST(request({ ...BASE, description: "d" }));
    expect(rushed.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next listed model when one is out of quota", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "model-a, model-b";
    const fetchMock = vi.fn(async (url: string) => (url.includes("model-a") ? geminiReply(429) : geminiReply()));
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(request({ ...BASE, description: "e" }))).json();
    expect(body.model).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a busy model once, then falls back to the next one", async () => {
    vi.useRealTimers(); // the retry waits 1.5 s for real
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "model-a,model-b";
    const fetchMock = vi.fn(async (url: string) => (url.includes("model-a") ? geminiReply(503) : geminiReply()));
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(request({ ...BASE, description: "g" }, "2.2.2.2"))).json();
    expect(body.model).toBe("model-b");
    expect(fetchMock.mock.calls.map((c) => String(c[0]).includes("model-a"))).toEqual([true, true, false]);
  });

  it("explains a quota error in plain words", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "model-a";
    vi.stubGlobal("fetch", vi.fn(async () => geminiReply(429)));
    const res = await POST(request({ ...BASE, description: "f" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/free-tier quota/);
  });
});
