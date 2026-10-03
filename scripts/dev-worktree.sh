#!/usr/bin/env bash
# 启动本 worktree 的 server + web。端口经 acquire-port 动态分配，绝不硬编码——
# 多个 worktree（和主开发实例）要能同时跑。
# web 起来后默认再开一条 CF quick 隧道并打印公网地址（用户手机/外网直接验收），
# 不想要公网入口就加 --no-tunnel。
# 用法：./scripts/dev-worktree.sh [--no-server] [--no-web] [--no-tunnel]
set -euo pipefail

WT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WT_ROOT"

WANT_SERVER=1
WANT_WEB=1
WANT_TUNNEL=1
for arg in "$@"; do
  case "$arg" in
    --no-server) WANT_SERVER=0 ;;
    --no-web) WANT_WEB=0 ;;
    --no-tunnel) WANT_TUNNEL=0 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

if [ "$WANT_SERVER" = 0 ] && [ "$WANT_WEB" = 0 ]; then
  echo "--no-server 与 --no-web 不能同时给：没东西可起"; exit 2
fi

if [ "$WANT_SERVER" = 1 ] && [ "$WANT_WEB" = 1 ]; then
  # server + web 共用一个内存槽位（512MB 预算），一次申请 2 个端口。
  # read 在 here-string 上永远成功（空输入也返回 0），拿不到端口时不会走 || 分支——
  # 必须逐个判空，否则端口号是空的，server 监听随机口、web 抢占默认 5173。
  read -r STAGE_PORT STAGE_WEB_PORT <<<"$(acquire-port --wait 2)" || true
  if [ -z "${STAGE_PORT:-}" ] || [ -z "${STAGE_WEB_PORT:-}" ]; then
    echo "!! 端口分配失败（跑 acquire-port --list 查槽位，或内存余量不足）"
    exit 1
  fi
elif [ "$WANT_WEB" = 1 ]; then
  STAGE_WEB_PORT="$(acquire-port --wait)" || { echo "!! web 端口分配失败"; exit 1; }
else
  STAGE_PORT="$(acquire-port --wait)" || { echo "!! server 端口分配失败"; exit 1; }
fi

[ -e .env ] || { echo "!! 缺少 .env，先跑 ./scripts/init-worktree.sh"; exit 1; }

# 确保预览实例开箱即有测试剧目（如 stub、test2）：若主仓库存在则按需软链
MAIN_ROOT="$(cd "$WT_ROOT" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | xargs dirname 2>/dev/null || true)"
if [ -n "$MAIN_ROOT" ] && [ -d "$MAIN_ROOT/plays" ]; then
  mkdir -p plays
  for p in "$MAIN_ROOT"/plays/*; do
    [ -d "$p" ] || continue
    name="$(basename "$p")"
    [ "$name" = "demo" ] && continue
    if [ ! -e "plays/$name" ]; then
      ln -s "$p" "plays/$name" 2>/dev/null || true
    fi
  done
fi

pids=()

# 公网入口走 [[dev-tunnel]] 的 quick tunnel（免登录、URL 随机、进程关了即失效）。
# 脚本路径可覆盖：TUNNEL_SH=/path/to/dev-tunnel.sh ./scripts/dev-worktree.sh
TUNNEL_SH="${TUNNEL_SH:-~/.agents/skills/dev-tunnel/scripts/dev-tunnel.sh}"
TUNNEL_STARTED=0

cleanup() {
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  # 隧道是 nohup 起的，不随本脚本退出，得自己收
  if [ "$TUNNEL_STARTED" = 1 ]; then
    bash "$TUNNEL_SH" stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# core 的 dist 不随 pnpm store 共享，web/server 都吃它 → 每个 worktree 自己建一次
pnpm --filter @aivn/core build

if [ "$WANT_SERVER" = 1 ]; then
  pnpm --filter @aivn/server build
  # config.ts 读 env.STAGE_PORT
  STAGE_PORT="$STAGE_PORT" pnpm --filter @aivn/server start &
  pids+=($!)
  echo "api:  http://127.0.0.1:$STAGE_PORT"
fi

if [ "$WANT_WEB" = 1 ]; then
  # 等 server 起来再起 web，否则首屏 API 全 502
  if [ "$WANT_SERVER" = 1 ]; then
    for _ in $(seq 1 40); do
      curl -sf "http://127.0.0.1:${STAGE_PORT}/api/health" >/dev/null && break
      sleep 0.25
    done
  fi
  # 代理目标两种约定都喂上：vite.config.ts 认 STAGE_PORT，也认 STAGE_SERVER 的完整 URL
  # `pnpm dev -- --port` 会把多余的 `--` 透传给 vite 导致参数失效（vite 静默用默认 5180），直接 exec vite
  STAGE_WEB_PORT="$STAGE_WEB_PORT" \
    STAGE_PORT="${STAGE_PORT:-}" \
    STAGE_SERVER="http://127.0.0.1:${STAGE_PORT:-8787}" \
    pnpm --filter @aivn/web exec vite --port "$STAGE_WEB_PORT" --strictPort &
  pids+=($!)
  echo "web:  http://127.0.0.1:$STAGE_WEB_PORT"
fi

if [ "$WANT_TUNNEL" = 1 ] && [ "$WANT_WEB" = 1 ]; then
  if [ ! -f "$TUNNEL_SH" ]; then
    echo "公网:  跳过（找不到 $TUNNEL_SH）"
  elif [ -f /tmp/dev-tunnel.pid ] && kill -0 "$(cat /tmp/dev-tunnel.pid)" 2>/dev/null; then
    # dev-tunnel.sh 只有一份全局 pidfile，且不校验端口：已有隧道在跑时它会把
    # 别人的旧 URL 当成你的报出来。宁可不报，也不能给错地址。
    echo "公网:  跳过（已有一条隧道在跑：$(bash "$TUNNEL_SH" status)）"
    echo "      先 dev-tunnel.sh stop，或本次加 --no-tunnel"
  else
    for _ in $(seq 1 40); do
      curl -sf "http://127.0.0.1:$STAGE_WEB_PORT/" >/dev/null && break
      sleep 0.25
    done
    if url=$(bash "$TUNNEL_SH" "$STAGE_WEB_PORT" 2>/dev/null); then
      TUNNEL_STARTED=1
      echo "公网:  $url"
    else
      echo "公网:  起隧道失败（查 /tmp/dev-tunnel.log），本地地址仍可用"
    fi
  fi
fi

wait
