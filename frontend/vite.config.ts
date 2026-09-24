import { defineConfig } from "vite";
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8080";
export default defineConfig({
  server: {
    proxy: { "/ws": { target: backend, ws: true }, "/healthz": backend },
  },
  build: {
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
  },
});
