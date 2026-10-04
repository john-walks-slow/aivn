#!/usr/bin/env bash
set -euo pipefail

WORKTREE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${WORKTREE_ROOT}"

echo "=== [AIVN Galgame Assets] Starting Development & Showcase Server ==="

# Acquire an unconflicted dynamic port
PORT=$(acquire-port --wait)
echo "Acquired dynamic slot port: ${PORT}"
echo "Preview server URL: http://127.0.0.1:${PORT}"
echo "Serving assets and interactive studio from: ${WORKTREE_ROOT}"

exec python3 "${WORKTREE_ROOT}/scripts/preview_server.py" --port "${PORT}"
