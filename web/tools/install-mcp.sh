#!/usr/bin/env bash
# 中华历史图谱 MCP 连接器一键配置（macOS / Linux）
# 作用：自动按脚本所在位置生成绝对路径的 MCP 配置 JSON，并尝试复制到剪贴板。
# 用法：bash web/tools/install-mcp.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$SCRIPT_DIR/history-mcp-server.mjs"
[ -f "$SERVER" ] || { echo "未找到 MCP Server 文件：$SERVER"; exit 1; }

JSON=$(cat <<EOF
{
  "mcpServers": {
    "chinese-history-atlas": {
      "command": "node",
      "args": ["$SERVER"],
      "env": {
        "CHAT_BASE_URL": "http://127.0.0.1:5173/web/"
      }
    }
  }
}
EOF
)

echo ''
echo '================ 中华历史图谱 MCP 配置 ================'
echo '将以下 JSON 粘贴到支持 MCP 的客户端（Hermes / Cursor / Claude Desktop 等）：'
echo ''
echo "$JSON"
echo ''
if command -v pbcopy >/dev/null 2>&1; then
  echo "$JSON" | pbcopy
  echo '已复制到剪贴板（pbcopy）。'
elif command -v xclip >/dev/null 2>&1; then
  echo "$JSON" | xclip -selection clipboard
  echo '已复制到剪贴板（xclip）。'
else
  echo '未检测到 pbcopy/xclip，请手动复制上方 JSON。'
fi
echo '======================================================'
