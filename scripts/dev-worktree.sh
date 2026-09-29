#!/usr/bin/env bash
# worktree 开发启动：acquire-port 动态取端口 → 同时起 server 与 web。
# 禁止硬编码端口；vite 代理目标经 STAGE_SERVER 传给 web。
set -euo pipefail
cd "$(dirname "$0")/.."

read -r PORT WEB_PORT <<<"$(acquire-port --wait 2)"

export STAGE_PORT="$PORT"
export STAGE_SERVER="http://127.0.0.1:${PORT}"

pnpm --filter @stage-ai/core build >/dev/null
pnpm --filter @stage-ai/server build

cleanup() {
  kill "${SERVER_PID:-}" 2>/dev/null || true
  kill "${WEB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

pnpm --filter @stage-ai/server start &
SERVER_PID=$!

# 等 server 起来再起 web，否则首屏 API 全 502
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${PORT}/api/plays" >/dev/null && break
  sleep 0.25
done

echo
echo "server : http://127.0.0.1:${PORT}"
echo "web    : http://127.0.0.1:${WEB_PORT}"
echo

# `pnpm dev -- --port` 会把多余的 `--` 透传给 vite 导致参数失效（vite 静默用默认 5180），直接 exec vite
pnpm --filter @stage-ai/web exec vite --port "$WEB_PORT" --strictPort &
WEB_PID=$!
wait "$WEB_PID"
