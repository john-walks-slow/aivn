#!/usr/bin/env bash
# 启动本 worktree 的 server + web。端口经 acquire-port 分配，绝不硬编码——
# 多个 worktree（和主开发实例）要能同时跑。
# 用法：./scripts/dev-worktree.sh [--no-server] [--no-web]
set -euo pipefail

WT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WT_ROOT"

WANT_SERVER=1
WANT_WEB=1
for arg in "$@"; do
  case "$arg" in
    --no-server) WANT_SERVER=0 ;;
    --no-web) WANT_WEB=0 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

# server + web 共用一个内存槽位（512MB 预算），一次申请 2 个端口
if [ "$WANT_SERVER" = 1 ] && [ "$WANT_WEB" = 1 ]; then
  read -r STAGE_PORT STAGE_WEB_PORT <<< "$(acquire-port --wait 2)" || {
    echo "!! 端口分配失败（跑 ./scripts/../acquire-port --list 查槽位，或内存余量不足）"; exit 1;
  }
elif [ "$WANT_WEB" = 1 ]; then
  STAGE_WEB_PORT="$(acquire-port --wait)" || { echo "!! web 端口分配失败"; exit 1; }
else
  STAGE_PORT="$(acquire-port --wait)" || { echo "!! server 端口分配失败"; exit 1; }
fi

[ -e .env ] || { echo "!! 缺少 .env，先跑 ./scripts/init-worktree.sh"; exit 1; }

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

if [ "$WANT_SERVER" = 1 ]; then
  pnpm --filter @stage-ai/core build
  pnpm --filter @stage-ai/server build
  # config.ts 读 env.STAGE_PORT
  STAGE_PORT="$STAGE_PORT" pnpm --filter @stage-ai/server start &
  pids+=($!)
  echo "api:  http://127.0.0.1:$STAGE_PORT"
fi

if [ "$WANT_WEB" = 1 ]; then
  # vite.config.ts 读 STAGE_WEB_PORT（自己的端口）与 STAGE_PORT（代理目标）
  STAGE_WEB_PORT="$STAGE_WEB_PORT" STAGE_PORT="${STAGE_PORT:-}" pnpm --filter @stage-ai/web dev &
  pids+=($!)
  echo "web:  http://127.0.0.1:$STAGE_WEB_PORT"
fi

wait
