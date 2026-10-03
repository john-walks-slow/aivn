import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 端口走 env（STAGE_WEB_PORT / STAGE_PORT）：worktree 并行开发时每棵工作树一套，别撞主仓正在跑的实例。
const serverPort = Number(process.env.STAGE_WEB_PORT ?? 5180);
/** 后端地址：默认按 STAGE_PORT 拼，多实例下也可用 STAGE_SERVER 直接指定整个地址。 */
const server = process.env.STAGE_SERVER ?? `http://127.0.0.1:${process.env.STAGE_PORT ?? "8787"}`;
/**
 * 允许的 Host。`vite --host` 会把 dev server 开到局域网，Vite 默认只认 localhost，
 * 走隧道或用自己的域名指过来就会被挡。默认放行 Cloudflare quick tunnel（`dev-tunnel` 技能给的就是它），
 * 自己的域名（命名隧道）用 `STAGE_ALLOWED_HOSTS=.example.com,...` 追加，别写进仓库。
 */
const allowedHosts = [
  ".trycloudflare.com",
  ...(process.env.STAGE_ALLOWED_HOSTS?.split(",").map((host) => host.trim()) ?? []),
].filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    port: serverPort,
    host: true,
    allowedHosts,
    proxy: {
      "/ws": {
        target: server.replace(/^http/, "ws"),
        ws: true,
      },
      "/api": server,
      "/plays": server,
      // 资源库素材预览：服务端只读静态路由。路径不在 /plays 下——库不是剧目目录
      "/library": server,
    },
  },
});
