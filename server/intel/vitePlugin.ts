// Dev-server endpoint: POST /api/intel {at, bbox} -> IntelReport. Keys stay on the server.
import type { Plugin } from "vite";
import type { IntelRequest } from "../../src/intel/types";
import { runOnlineSearch } from "./onlineSearch";
import type { IntelEnv } from "./sources/common";

export function intelApi(env: IntelEnv): Plugin {
  return {
    name: "intel-api",
    configureServer(server) {
      server.middlewares.use("/api/intel", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        try {
          let body = "";
          for await (const chunk of req) body += chunk;
          const request = JSON.parse(body) as IntelRequest;
          const report = await runOnlineSearch(request, env);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(report));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    },
  };
}
