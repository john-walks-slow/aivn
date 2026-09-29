#!/usr/bin/env bash
# worktree 开发服务：动态端口起 server + web，STAGE_PORT 串起来，proxy 走同一棵树。
set -euo pipefail
cd "$(dirname "$0")/.."
PORTS=$(acquire-port --wait 2)
PORT=${PORTS%% *}
API_PORT=${PORTS##* }
export STAGE_PORT="$API_PORT"
export STAGE_WEB_PORT="$PORT"
echo "web  http://127.0.0.1:${PORT}"
echo "api  http://127.0.0.1:${API_PORT}"

cleanup() { kill $(jobs -p) 2>/dev/null || true; acquire-port --release "$PORT" >/dev/null 2>&1 || true; acquire-port --release "$API_PORT" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
pnpm --filter @stage-ai/server start &
pnpm --filter @stage-ai/web dev --host --port "$PORT" &
wait
