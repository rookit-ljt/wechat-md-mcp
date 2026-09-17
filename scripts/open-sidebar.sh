#!/bin/bash
# scripts/open-sidebar.sh
# 
# 一键拉起可视化编辑器并在侧边栏/浏览器打开指定文章。
# 供 Agent 或命令行直接调用，自动处理：
# 1. NODE_OPTIONS 清洗与 WorkBuddy 沙箱 FS 钩子隔离
# 2. Node >= 20 环境探测
# 3. 本地 HTTP 服务探活与无痛后台自启
# 4. 文章载入 (/load) 与 URL 生成
# 5. 自动唤起侧边栏/默认浏览器
#
# 用法：
#   ./scripts/open-sidebar.sh <path-to-article.md>
#   ./scripts/open-sidebar.sh <path-to-article.md> --url-only   # 仅输出 URL (供 present_files 使用)
#   ./scripts/open-sidebar.sh <path-to-article.md> --browser    # 强制弹出外部系统浏览器

set -uo pipefail

# 1. 清理可能导致 tsx / Node 崩溃的注入变量
unset NODE_OPTIONS || true
export CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_FILE="$REPO_ROOT/.service-port.json"
REQUIRED_MAJOR=20
NODE_BIN=""

# 2. 探测可用 Node >= 20
probe_node() {
  local candidate="$1"
  [ -n "$candidate" ] || return 1
  [ -x "$candidate" ] || return 1

  local version major
  version=$("$candidate" -v 2>/dev/null || true)
  [ -n "$version" ] || return 1
  version=${version#v}
  major=${version%%.*}
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  (( major >= REQUIRED_MAJOR )) || return 1

  NODE_BIN="$candidate"
  return 0
}

if [ -n "${MD_SERVICE_NODE:-}" ]; then
  probe_node "$MD_SERVICE_NODE" || true
fi

if [ -z "$NODE_BIN" ]; then
  PATH_NODE="$(command -v node 2>/dev/null || true)"
  if [ -n "$PATH_NODE" ]; then
    probe_node "$PATH_NODE" || true
  fi
fi

if [ -z "$NODE_BIN" ]; then
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \
    "$HOME"/.volta/bin/node
  do
    if [ -e "$candidate" ]; then
      if probe_node "$candidate"; then
        break
      fi
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "错误: 未找到 Node.js >= $REQUIRED_MAJOR" >&2
  exit 1
fi

TSX="$REPO_ROOT/node_modules/tsx/dist/cli.mjs"
if [ ! -f "$TSX" ]; then
  echo "错误: 缺少依赖，请先在 $REPO_ROOT 下运行 npm install" >&2
  exit 1
fi

# 3. 解析参数
FILE_PATH=""
URL_ONLY=false
FORCE_BROWSER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url-only|-u)
      URL_ONLY=true
      shift
      ;;
    --browser|-b)
      FORCE_BROWSER=true
      shift
      ;;
    *)
      if [ -z "$FILE_PATH" ]; then
        FILE_PATH="$1"
      fi
      shift
      ;;
  esac
done

# 4. 服务探活与后台启动
is_alive() {
  local port="$1"
  curl -s -m 2 "http://127.0.0.1:$port/health" 2>/dev/null | grep -q '"ok":true' 2>/dev/null
}

get_active_port() {
  if [ -f "$PORT_FILE" ]; then
    local saved_port
    saved_port=$(grep -o '"port":[0-9]*' "$PORT_FILE" 2>/dev/null | cut -d: -f2 || true)
    if [ -n "$saved_port" ] && is_alive "$saved_port"; then
      echo "$saved_port"
      return 0
    fi
  fi
  # 扫描默认及顺延端口 (8788 - 8798)
  for p in {8788..8798}; do
    if is_alive "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

PORT=""
if PORT=$(get_active_port); then
  : # 服务已在运行
else
  # 后台启动服务
  nohup "$NODE_BIN" "$TSX" "$REPO_ROOT/run-server.mjs" > /dev/null 2>&1 &
  
  # 等待服务就绪（最多等 10 秒）
  for _ in {1..20}; do
    sleep 0.5
    if PORT=$(get_active_port); then
      break
    fi
  done

  if [ -z "$PORT" ]; then
    echo "错误: 编辑器后台服务启动超时，请手动执行 npm start 检查错误" >&2
    exit 1
  fi
fi

# 5. 载入文章生成链接
EDITOR_URL=""
if [ -n "$FILE_PATH" ]; then
  if [ ! -f "$FILE_PATH" ]; then
    echo "错误: 文件不存在: $FILE_PATH" >&2
    exit 1
  fi
  ABS_FILE="$(cd "$(dirname "$FILE_PATH")" && pwd)/$(basename "$FILE_PATH")"
  
  # 调用 /load 接口
  LOAD_RES=$(curl -s -X POST "http://127.0.0.1:$PORT/load" \
    -H "Content-Type: application/json" \
    -d "{\"path\": \"$ABS_FILE\"}")
  
  EDITOR_URL=$(echo "$LOAD_RES" | grep -o '"url":"[^"]*' | cut -d'"' -f4 || true)
fi

if [ -z "$EDITOR_URL" ]; then
  EDITOR_URL="http://127.0.0.1:$PORT/?from=agent"
fi

# 6. 执行唤起与输出
if [ "$URL_ONLY" = true ]; then
  echo "$EDITOR_URL"
else
  echo "================================================="
  echo "✅ 可视化编辑器已就绪！"
  echo "🔗 访问地址: $EDITOR_URL"
  echo "================================================="
  
  # 如果在 macOS 上且需要唤起浏览器（或非仅输出模式）
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if [ "$FORCE_BROWSER" = true ] || [ -z "${WORKBUDDY_ACTIVE_SESSION:-}" ]; then
      open "$EDITOR_URL"
    fi
  fi
fi
