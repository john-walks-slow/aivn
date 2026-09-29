import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 端口走 env（STAGE_WEB_PORT / STAGE_PORT）：worktree 并行开发时每棵工作树一套，别撞主仓正在跑的实例。
const serverPort = Number(process.env.STAGE_WEB_PORT ?? 5180);
const apiPort = process.env.STAGE_PORT ?? "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: serverPort,
    host: true,
    allowedHosts: [".trycloudflare.com", ".example.com"],
    proxy: {
      "/ws": {
        target: `ws://127.0.0.1:${apiPort}`,
        ws: true,
      },
      "/api": `http://127.0.0.1:${apiPort}`,
      "/plays": `http://127.0.0.1:${apiPort}`,
    },
  },
});
