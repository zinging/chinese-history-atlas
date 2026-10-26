/**
 * Chinese History Atlas · DSH 连接器（bundle 载体）
 *
 * 这个文件只是为了满足 bundle 的形态要求（有 main/exports）。
 * 真正的能力来自 web/tools/history-mcp-server.mjs——一个零依赖的 MCP Server，
 * 由 DSH 的 @deepseek-ai/dsh-mcp-client 拉起，注册成 mcp__atlas__* 工具。
 *
 * 因此这里不注册任何 Host 插件，也不 import 站点代码：
 *   - bundle 的 cordis.patch.yml 已经把 MCP Server 登记好
 *   - index.js 保持空实现，避免重复注册或引入 DSH 未提供的 API
 */

export function apply() {
  // 能力在 cordis.patch.yml 里声明，这里无需动作。
}
