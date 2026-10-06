#!/usr/bin/env bash
#
# 全新 clone 能不能构建 —— 实跑，不看配置推断。
#
# 为什么要有它：「新机器 clone 下来构建不出来」这类失败是静默的（我这台机器一切正常，
# 别人那里才炸），靠人记得手动演一遍等于没防。这条链上任何一处搬了引用点没搬全，
# 都会在下一次手动演练之前没人知道。
#
# 本地与远端一致时从**远端**克隆，否则从本地克隆并点名这个差别——从本地克隆只证明了
# 这份 commit 树能构建，证明不了远端那份。
#
#   bash scripts/verify-fresh-clone.sh
#
# 失败时保留临时目录并打印路径；成功即删。
set -euo pipefail

SRC=$(git rev-parse --show-toplevel)
cd "$SRC"
HEAD_SHA=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')

# 比对的是 `origin/<分支>` 而不是 `@{u}`：分支没配 upstream 时 `@{u}` 直接失败，
# 会得出「无远端」这种与事实相反的结论。先 fetch，保证比的是远端此刻的样子。
REMOTE_REF=''
RELATION='无 origin 远端'
AHEAD=''
BEHIND=''
if git remote get-url origin >/dev/null 2>&1; then
	if git fetch --quiet origin "$BRANCH" 2>/dev/null && git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
		REMOTE_REF="origin/$BRANCH"
		AHEAD=$(git rev-list --count "$REMOTE_REF..HEAD")
		BEHIND=$(git rev-list --count "HEAD..$REMOTE_REF")
		RELATION="$REMOTE_REF：领先 $AHEAD / 落后 $BEHIND"
	fi
fi
if [ -n "$REMOTE_REF" ] && [ "$AHEAD" = 0 ] && [ "$BEHIND" = 0 ]; then
	CLONE_SOURCE=remote
else
	CLONE_SOURCE=local
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/verify-fresh-clone.XXXXXX")
cleanup() {
	[ "${KEEP:-0}" = 1 ] && return 0
	if [ -n "${KEEP_ON_FAIL:-}" ]; then
		echo "临时目录留着排查：$TMP"
	else
		rm -rf "$TMP"
	fi
}
trap cleanup EXIT

echo '== 现场'
echo "  源仓库：$SRC"
echo "  HEAD：$HEAD_SHA ($BRANCH)"
echo "  工作树：$([ "$DIRTY" = 0 ] && echo 干净 || echo "$DIRTY 处未提交")"
echo "  远端：$RELATION"

echo
echo '== 克隆'
if [ "$CLONE_SOURCE" = remote ]; then
	URL=$(git remote get-url origin)
	if git clone --quiet "$URL" "$TMP/repo" 2>/dev/null; then
		echo "  克隆源：远端 $URL"
	else
		echo '  克隆源：远端克隆失败（网络或凭据），退成本地克隆'
		git clone --quiet --no-local "$SRC" "$TMP/repo"
	fi
else
	git clone --quiet --no-local "$SRC" "$TMP/repo"
	if [ -n "$REMOTE_REF" ]; then
		echo "  克隆源：本地 $SRC（本地与 $REMOTE_REF 不一致，这一次只证明这份 commit 树）"
	else
		echo "  克隆源：本地 $SRC（没有可用的远端可克隆）"
	fi
fi
echo "  克隆到的 HEAD：$(git -C "$TMP/repo" rev-parse --short HEAD)"
echo "  .worktrees/：$([ -d "$TMP/repo/.worktrees" ] && echo '存在（不该有）' || echo 无)"

cd "$TMP/repo"
KEEP_ON_FAIL=1

echo
echo '== 1/3 pnpm install --frozen-lockfile'
pnpm install --frozen-lockfile

echo
echo '== 2/3 pnpm -r build'
pnpm -r build

echo
echo '== 3/3 产物落地'
MISSING=0
for file in packages/core/dist/index.js packages/stage/dist/index.js packages/stage/dist/stage.css apps/web/dist/index.html apps/server/dist/index.js; do
	if [ -e "$file" ]; then
		echo "  ✓ $file"
	else
		echo "  ✗ $file 不在"
		MISSING=1
	fi
done
[ "$MISSING" = 0 ] || { echo '有产物没落地'; exit 1; }

KEEP_ON_FAIL=
echo
echo '全新 clone 能构建：安装、构建、产物三步全过。'
