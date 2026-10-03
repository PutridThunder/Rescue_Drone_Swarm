import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    minify: false,
    cssMinify: false,
    chunkSizeWarningLimit: 1000,
  },
});
