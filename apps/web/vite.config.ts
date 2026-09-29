import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** 后端地址：worktree/多实例下端口动态分配，默认仍是本地 8787。 */
const server = process.env.STAGE_SERVER ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: true,
    allowedHosts: [".trycloudflare.com", ".example.com"],
    proxy: {
      "/ws": {
        target: server.replace(/^http/, "ws"),
        ws: true,
      },
      "/api": server,
      "/plays": server,
    },
  },
});
