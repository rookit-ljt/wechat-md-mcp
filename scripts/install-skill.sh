#!/bin/sh
# 把 skills/wechat-md 软链到各家 agent 的 skills 目录。
#
# 用法：
#   ./scripts/install-skill.sh            安装（已存在则跳过）
#   ./scripts/install-skill.sh --force    已存在时先移除再重建
#   ./scripts/install-skill.sh --uninstall 移除全部软链
#
# 软链而不是复制：改仓库里那一份 SKILL.md，四家同时生效。
set -eu

SKILL_NAME=wechat-md
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$REPO_ROOT/skills/$SKILL_NAME"

MODE=install
case "${1:-}" in
  --force)     MODE=force ;;
  --uninstall) MODE=uninstall ;;
  '')          MODE=install ;;
  *)
    echo "未知参数：$1" >&2
    echo "用法：$0 [--force | --uninstall]" >&2
    exit 2
    ;;
esac

[ -d "$SRC" ] || { echo "找不到 skill 源目录：$SRC" >&2; exit 1; }

# 各家 agent 的 skills 目录。不存在的跳过，不硬建——
# 没装这个 agent 就没必要给它留目录。
TARGETS="$HOME/.claude/skills $HOME/.codex/skills $HOME/.cursor/skills $HOME/.workbuddy/skills"

linked=0
skipped=0
removed=0

for dir in $TARGETS; do
  [ -d "$dir" ] || { [ "$MODE" = uninstall ] || echo "跳过 $dir（目录不存在，未安装该 agent）"; continue; }
  link="$dir/$SKILL_NAME"

  if [ "$MODE" = uninstall ]; then
    if [ -L "$link" ]; then
      rm "$link"
      echo "已移除 $link"
      removed=$((removed + 1))
    fi
    continue
  fi

  if [ -L "$link" ] || [ -e "$link" ]; then
    if [ "$MODE" = force ]; then
      rm -rf "$link"
      ln -s "$SRC" "$link"
      echo "已重建 $link"
      linked=$((linked + 1))
    else
      echo "已存在，跳过 $link（要覆盖用 --force）"
      skipped=$((skipped + 1))
    fi
    continue
  fi

  ln -s "$SRC" "$link"
  echo "已链接 $link -> $SRC"
  linked=$((linked + 1))
done

echo
case "$MODE" in
  uninstall) echo "完成：移除 $removed 条软链" ;;
  *)         echo "完成：新增 $linked 条，跳过 $skipped 条" ;;
esac

if [ "$MODE" != uninstall ] && [ "$linked" -gt 0 ]; then
  echo "重启对应客户端后生效，然后直接说「把这篇排版成公众号格式」。"
fi
