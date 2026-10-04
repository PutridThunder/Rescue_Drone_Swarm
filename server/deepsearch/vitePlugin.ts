// Dev-server copy of the Vercel function: POST /api/deepsearch, same handler as api/deepsearch.ts.
// The Gemini key comes from .env.local (GEMINI_API_KEY=...), never from the browser.
import type { Plugin } from "vite";
import { POST } from "../../api/deepsearch.ts";

export function deepSearchApi(env: Record<string, string>): Plugin {
  return {
    name: "deepsearch-api",
    configureServer(server) {
      // Vite's env loader doesn't populate process.env for non-VITE_ keys; the handler reads it there.
      if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
      if (env.GEMINI_MODEL) process.env.GEMINI_MODEL = env.GEMINI_MODEL;
      server.middlewares.use("/api/deepsearch", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("{}");
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        const response = await POST(new Request("http://localhost/api/deepsearch", { method: "POST", body }));
        res.statusCode = response.status;
        res.setHeader("Content-Type", "application/json");
        res.end(await response.text());
      });
    },
  };
}
