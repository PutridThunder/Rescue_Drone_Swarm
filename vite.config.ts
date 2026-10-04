import { defineConfig, loadEnv } from "vite";
import { areasApi } from "./server/areas/vitePlugin.ts";
import { deepSearchApi } from "./server/deepsearch/vitePlugin.ts";

export default defineConfig(({ mode }) => ({
  // "" prefix: also load server-only keys (GEMINI_API_KEY) for the dev API; only VITE_* reach the browser.
  plugins: [areasApi(), deepSearchApi(loadEnv(mode, process.cwd(), ""))],
  build: {
    target: "es2022",
    minify: false,
    cssMinify: false,
    chunkSizeWarningLimit: 1000,
  },
}));
