// Dev-server copy of the Vercel function: /api/snowflake, same handlers as api/snowflake.ts.
// Credentials come from .env.local (SNOWFLAKE_ACCOUNT, SNOWFLAKE_TOKEN, ...), never the browser.
import type { Plugin } from "vite";
import { GET, POST } from "../../api/snowflake.ts";

const KEYS = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_TOKEN", "SNOWFLAKE_WAREHOUSE", "SNOWFLAKE_DATABASE", "SNOWFLAKE_SCHEMA", "SNOWFLAKE_ROLE"];

export function snowflakeApi(env: Record<string, string>): Plugin {
  return {
    name: "snowflake-api",
    configureServer(server) {
      // Vite doesn't copy non-VITE_ keys into process.env; the handler reads it there.
      for (const k of KEYS) if (env[k]) process.env[k] = env[k];
      server.middlewares.use("/api/snowflake", async (req, res) => {
        let response: Response;
        if (req.method === "GET") response = await GET();
        else if (req.method === "POST") {
          let body = "";
          for await (const chunk of req) body += chunk;
          response = await POST(new Request("http://localhost/api/snowflake", { method: "POST", body, headers: { "x-forwarded-for": req.socket.remoteAddress ?? "local" } }));
        } else {
          res.statusCode = 405;
          return res.end("{}");
        }
        res.statusCode = response.status;
        res.setHeader("Content-Type", "application/json");
        res.end(await response.text());
      });
    },
  };
}
