#!/usr/bin/env bash
# worktree 初始化：依赖安装 + 环境就绪。端口不写死——dev-worktree.sh 现取。
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install

# .env 不进 git：worktree 从主仓复制一份（含网关/TTS 凭据），端口由 dev-worktree.sh 动态注入
if [[ ! -f .env ]]; then
  if [[ -f ../.env ]]; then
    cp ../.env .env
    echo "已从主仓复制 .env"
  else
    echo "警告：主仓没有 .env，生图/TTS/网关需自行配置" >&2
  fi
fi

pnpm --filter @stage-ai/core build
echo "worktree 就绪。启动：scripts/dev-worktree.sh"
