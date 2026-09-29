import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** 后端地址：worktree 调试时用 STAGE_API_TARGET 指向本 worktree 的 server 实例。 */
const api = process.env.STAGE_API_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: true,
    allowedHosts: [".trycloudflare.com", ".example.com"],
    proxy: {
      "/ws": {
        target: api,
        ws: true,
      },
      "/api": api,
      "/plays": api,
    },
  },
});
