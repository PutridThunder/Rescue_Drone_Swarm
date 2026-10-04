import { defineConfig, loadEnv } from "vite";
import { areasApi } from "./server/areas/vitePlugin.ts";
import { snowflakeApi } from "./server/snowflake/vitePlugin.ts";

export default defineConfig(({ mode }) => ({
  // "" prefix: also load server-only keys (SNOWFLAKE_*) for the dev API; only VITE_* reach the browser.
  plugins: [areasApi(), snowflakeApi(loadEnv(mode, process.cwd(), ""))],
  build: {
    target: "es2022",
    minify: false,
    cssMinify: false,
    chunkSizeWarningLimit: 1000,
  },
}));
