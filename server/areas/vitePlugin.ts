// Dev-server endpoint: POST /api/areas {query} -> {id, name} after building the area's map.
import type { Plugin } from "vite";
import { importArea } from "./importArea.ts";

export function areasApi(): Plugin {
  return {
    name: "areas-api",
    configureServer(server) {
      server.middlewares.use("/api/areas", async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("{}");
        }
        try {
          let body = "";
          for await (const chunk of req) body += chunk;
          const { query } = JSON.parse(body) as { query?: string };
          if (!query || query.length > 120) throw new Error("enter a place name");
          res.end(JSON.stringify(await importArea(query)));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    },
  };
}
