import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev: forward API calls to the FastAPI service (see services/api).
    proxy: {
      "/api": { target: process.env.API_URL ?? "http://localhost:8000", changeOrigin: true },
    },
  },
});
