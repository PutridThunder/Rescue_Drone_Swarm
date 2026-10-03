import { defineConfig } from "vite";
import { areasApi } from "./server/areas/vitePlugin";

export default defineConfig({
  plugins: [areasApi()],
  build: {
    target: "es2022",
    minify: false,
    cssMinify: false,
    chunkSizeWarningLimit: 1000,
  },
});
