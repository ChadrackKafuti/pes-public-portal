/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

// BASE_PATH is set by the GitHub Pages workflow to "/<repository name>/". For a custom domain set BASE_PATH="/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    react(),
    visualizer({ filename: "dist/stats.html", gzipSize: true, template: "treemap", open: false }),
  ],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/zustand") || id.includes("node_modules/react-router")) return "react";
          if (id.includes("@esri/calcite-components")) return "calcite";
          if (id.includes("node_modules/chart.js") || id.includes("react-chartjs-2")) return "charts";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
