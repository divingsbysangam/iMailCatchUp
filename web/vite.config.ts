import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev only: the API runs on :3000. Set PUBLIC_ORIGIN=http://localhost:5173 on the server.
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false },
});
