# 中华历史图谱 MCP 连接器一键配置（Windows / PowerShell）
# 作用：自动按脚本所在位置生成绝对路径的 MCP 配置 JSON，并复制到剪贴板。
# 用法：在项目根目录执行  npm run mcp:install
#       或右键“使用 PowerShell 运行”本脚本。
$ErrorActionPreference = 'Stop'

$server = Join-Path $PSScriptRoot 'history-mcp-server.mjs'
if (-not (Test-Path -LiteralPath $server)) {
  throw "未找到 MCP Server 文件：$server"
}
$node = (Get-Command node -ErrorAction Stop).Source

$config = [ordered]@{
  mcpServers = [ordered]@{
    'chinese-history-atlas' = [ordered]@{
      command = 'node'
      args    = @($server)
      env     = [ordered]@{
        CHAT_BASE_URL = 'http://127.0.0.1:5173/web/'
      }
    }
  }
}
$json = $config | ConvertTo-Json -Depth 8

$copied = $false
try { Set-Clipboard -Value $json; $copied = $true } catch {
  try { $json | clip.exe; $copied = $true } catch { $copied = $false }
}

Write-Host ''
Write-Host '================ 中华历史图谱 MCP 配置 ================' -ForegroundColor Cyan
if ($copied) {
  Write-Host '以下 JSON 已复制到剪贴板，可直接粘贴到支持 MCP 的客户端' -ForegroundColor Green
  Write-Host '（Hermes / Cursor / Claude Desktop 等的 mcp 配置文件）：' -ForegroundColor Green
} else {
  Write-Warning '复制到剪贴板失败，请手动复制下方 JSON。'
}
Write-Host ''
Write-Host $json
Write-Host ''
Write-Host '豆包桌面客户端（图形界面）请填写：' -ForegroundColor Yellow
Write-Host ('  类型：STDIO')
Write-Host ('  命令：' + $node)
Write-Host ('  参数：' + $server)
Write-Host '  模式：仅本地电脑'
Write-Host ''
Write-Host '配置完成后，在新会话第一句话直接提问即可（模型会先自动探活/启动本地站点并打开网页）。'
Write-Host '======================================================' -ForegroundColor Cyan
