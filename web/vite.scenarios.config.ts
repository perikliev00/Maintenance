import { defineConfig } from "vite";
import base from "./vite.config";
export default defineConfig({
  ...base,
  server: { ...base.server, host: "127.0.0.1", port: 5185, strictPort: true, proxy: {
    "/api": { target: "http://127.0.0.1:4018", changeOrigin: true, rewrite: path => path.replace(/^\/api/, "") },
  } },
});
