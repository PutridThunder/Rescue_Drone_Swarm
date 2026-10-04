import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAnswer, parseRequest, POST } from "../../api/deepsearch";
import { DEFAULT_WEIGHTS } from "../sim/defaults";
import { toPlannerWeights } from "./deepSearch";

const WEIGHTS = { population: 0.9, hazard: 0.5, urgency: 1, unsearched_area: 0.5, distance_cost: 0.25, battery_cost: 0.5, avoid_overlap: 0 };
const request = (body: unknown) => new Request("http://x/api/deepsearch", { method: "POST", body: JSON.stringify(body) });

describe("DeepSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("parses Gemini's JSON even with text around it, clamping and rounding weights", () => {
    const r = parseAnswer(`Here you go:\n${JSON.stringify({ summary: "Busy waterfront.", weights: { ...WEIGHTS, hazard: 1.7, distance_cost: 0.25 }, reasons: { hazard: "flood zone" } })}`);
    expect(r.weights.hazard).toBe(1);
    expect(r.weights.distance_cost).toBe(0.3);
    expect(r.reasons.hazard).toBe("flood zone");
    expect(r.summary).toBe("Busy waterfront.");
  });

  it("rejects answers with a missing weight", () => {
    expect(() => parseAnswer(JSON.stringify({ weights: { population: 1 } }))).toThrow(/hazard/);
  });

  it("validates and trims the request", () => {
    expect(() => parseRequest({ lat: 200, lon: 0 })).toThrow();
    const r = parseRequest({ lat: 49.3, lon: -123.1, scenario: "tsunami", description: "x".repeat(2000) });
    expect(r.scenario).toBe("tsunami");
    expect(r.description.length).toBe(600);
  });

  it("maps 0.5 to the tuned default, 1 to double, 0 to off", () => {
    const w = toPlannerWeights(WEIGHTS);
    expect(w.urgency).toBe(DEFAULT_WEIGHTS.urgency * 2);
    expect(w.hazard).toBe(DEFAULT_WEIGHTS.hazard);
    expect(w.redundancy).toBe(0);
    expect(w.information).toBe(DEFAULT_WEIGHTS.information);
  });

  it("says so when the key is missing", async () => {
    const res = await POST(request({ lat: 49.3, lon: -123.1 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/GEMINI_API_KEY/);
  });

  it("calls Gemini with the key in a header and returns weights and sources", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ summary: "s", weights: WEIGHTS, reasons: {} }) }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.org/a", title: "Example" } }] },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(request({ lat: 49.3, lon: -123.1, area: "Lonsdale" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weights.population).toBe(0.9);
    expect(body.sources).toEqual([{ title: "Example", url: "https://example.org/a" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("test-key"); // key travels in a header, not the URL
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body as string).tools).toEqual([{ google_search: {} }]);
  });
});
