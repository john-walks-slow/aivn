#!/usr/bin/env bash
# worktree 初始化：装依赖 + 准备运行环境（.env 等只在主仓的文件）。
set -euo pipefail
cd "$(dirname "$0")/.."
MAIN=$(git rev-parse --git-common-dir)/..
MAIN=$(cd "$MAIN" && pwd)

[ -f .env ] || { [ -f "$MAIN/.env" ] && cp "$MAIN/.env" .env && echo "已从主仓复制 .env"; }
pnpm install
pnpm --filter @stage-ai/core build
echo "init ok: $(pwd)"
