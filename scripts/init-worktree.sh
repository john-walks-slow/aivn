#!/usr/bin/env bash
# 在 worktree 里准备开发环境：装依赖、构建 core（web/server 走 workspace symlink 的 dist 类型）、
# 建一份给本实例用的 .env（复用主仓库的凭据，不写进 worktree 的 git）。
set -euo pipefail

WT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# worktree 里 .git 是文件，common-dir 才是主仓库的 .git——它的父目录就是主仓库根
MAIN_ROOT="$(cd "$WT_ROOT" && git rev-parse --path-format=absolute --git-common-dir | xargs dirname)"
cd "$WT_ROOT"

echo "worktree: $WT_ROOT"
echo "main:     $MAIN_ROOT"

if [ ! -d node_modules ]; then
  echo "→ pnpm install"
  pnpm install
fi

# pnpm 的 node_modules 是共享 store + 每包软链，构建产物（dist）不共享 → 每个 worktree 自己建一次
echo "→ build core"
pnpm --filter @stage-ai/core build

# .env：凭据只留主仓库一份，worktree 用软链，避免第二份密钥副本
if [ ! -e .env ]; then
  if [ -f "$MAIN_ROOT/.env" ]; then
    ln -s "$MAIN_ROOT/.env" .env
    echo "→ .env → $MAIN_ROOT/.env"
  else
    echo "!! 主仓库没有 .env，dev-worktree.sh 会起不来（缺 cpa 网关/STAGE_API_KEY）"
  fi
fi

echo "✓ 就绪：./scripts/dev-worktree.sh 启动本 worktree 的 server + web"
