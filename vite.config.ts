import { defineConfig, loadEnv } from "vite";
import { intelApi } from "./server/intel/vitePlugin";

export default defineConfig(({ mode }) => {
  // Optional free API keys for online crowd intel, read from .env.local (never sent to the browser).
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [intelApi(env)],
    build: {
      target: "es2022",
      minify: false,
      cssMinify: false,
      chunkSizeWarningLimit: 1000,
    },
  };
});
