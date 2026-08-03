import { VscodeApi } from '../types'

/**
 * 打开配置文件并选中对应行范围。
 * filePath 支持 "路径:起始行-结束行" / "路径:行号" / 纯路径三种格式（与 sema-core 返回的定位字符串约定一致）。
 */
export function openFileWithRange(vscode: VscodeApi, filePath: string): void {
    const match = filePath.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/)
    if (!match) return
    vscode.postMessage({
        command: 'openFile',
        filePath: match[1],
        ...(match[2] ? { line: Number(match[2]) } : {}),
        ...(match[3] ? { endLine: Number(match[3]) } : {}),
    })
}
