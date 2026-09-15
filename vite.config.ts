import { defineConfig } from "vite";

// BASE_PATH is set by the GitHub Pages workflow to "/<repository name>/".
// For a custom domain or a root deployment set BASE_PATH="/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
  },
});
