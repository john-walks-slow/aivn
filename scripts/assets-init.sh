#!/usr/bin/env bash
set -euo pipefail

WORKTREE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "=== [Stage-AI Galgame Assets] Initializing Worktree Environment ==="
echo "Worktree Root: ${WORKTREE_ROOT}"

# 1. Check Python 3 and core imaging libraries
echo "[1/4] Checking Python environment..."
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 not found." >&2
    exit 1
fi

python3 -c "
import sys
print(f'Python: {sys.version.split()[0]}')
try:
    import PIL
    print(f'Pillow: {PIL.__version__}')
except ImportError:
    print('WARNING: Pillow not installed. Installing via pip...')
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pillow'])

try:
    import numpy
    print(f'NumPy: {numpy.__version__}')
except ImportError:
    print('WARNING: NumPy not installed. Installing via pip...')
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'numpy'])
"

# 2. Check ffmpeg
echo "[2/4] Checking multimedia tools (ffmpeg)..."
if command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg: $(ffmpeg -version 2>&1 | head -n 1)"
else
    echo "WARNING: ffmpeg is not found. Audio loop crossfade functions may need ffmpeg."
fi

# 3. Check CPA Gateway / Imagegen connectivity
echo "[3/4] Checking CPA Gateway connectivity (http://127.0.0.1:9999)..."
if curl -s --max-time 3 -H "Authorization: Bearer sk-1234" http://127.0.0.1:9999/v1/models >/dev/null 2>&1; then
    echo "CPA Gateway: OK (port 9999 connected)"
else
    echo "WARNING: CPA Gateway at 127.0.0.1:9999 not responding. Online image generation will fall back to mock or direct API."
fi

# 4. Permissions
echo "[4/4] Setting execution permissions..."
chmod +x "${WORKTREE_ROOT}/scripts/"*.sh 2>/dev/null || true
chmod +x "${WORKTREE_ROOT}/scripts/"*.py 2>/dev/null || true

echo "=== Initialization Completed Successfully ==="
