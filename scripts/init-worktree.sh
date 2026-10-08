#!/usr/bin/env bash
# 在 worktree 里准备开发环境：装依赖、构建 core（web/server 走 workspace symlink 的 dist 类型）、
# 把主仓库的 .env 链过来（凭据只留一份，不写进 worktree 的 git）。
# 端口不写死——dev-worktree.sh 每次现取。
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
pnpm --filter @aivn/core build

# .env：凭据只留主仓库一份，worktree 用软链，避免第二份密钥副本
if [ ! -e .env ]; then
  if [ -f "$MAIN_ROOT/.env" ]; then
    ln -s "$MAIN_ROOT/.env" .env
    echo "→ .env → $MAIN_ROOT/.env"
  else
    echo "!! 主仓库没有 .env，dev-worktree.sh 会起不来（缺 cpa 网关/STAGE_API_KEY；生图/TTS 需自行配置）"
  fi
fi

# plays：把主仓库里除了 demo 之外的本地剧目（如 stub、test2 等）软链到本 worktree，
# 预览时开箱即有现成周目、立绘与选项可测，无需重新搭台跑模型。
mkdir -p plays
for p in "$MAIN_ROOT"/plays/*; do
  [ -d "$p" ] || continue
  name="$(basename "$p")"
  [ "$name" = "demo" ] && continue
  if [ ! -e "plays/$name" ]; then
    ln -s "$p" "plays/$name"
    echo "→ plays/$name → $p"
  fi
done

# settings.json / media-cache：运行期设置与可重建缓存同样软链——预览实例用与主仓库
# 同一份设置（模型网关、TTS 等），换 worktree 不等于重配一遍。
for f in settings.json media-cache; do
  if [ ! -e "$f" ] && [ -e "$MAIN_ROOT/$f" ]; then
    ln -s "$MAIN_ROOT/$f" "$f"
    echo "→ $f → $MAIN_ROOT/$f"
  fi
done

echo "✓ 就绪：./scripts/dev-worktree.sh 启动本 worktree 的 server + web"
