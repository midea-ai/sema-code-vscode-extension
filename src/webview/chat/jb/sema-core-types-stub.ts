// web bundle 专用 stub：只提供 semaSessionWrapper 需要的运行时常量。
// 直接 import 'sema-core/types' 会拽入整个 Node 大脑（StateManager→MCP→cross-spawn 等），
// 在浏览器/JCEF 里既臃肿又无法解析 node 模块，故只在 jb 入口把该模块别名到此。
// 类型不受影响（编译期从真实 sema-core 取，运行期用不到）。
export const MAIN_AGENT_ID = 'main';
