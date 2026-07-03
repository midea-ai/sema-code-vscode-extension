import { SemaCore } from 'sema-core';
import type { SemaSession } from 'sema-core';

/**
 * SemaCoreManager —— 进程级单例。
 *
 * 对齐 VSCode 端的 SemaProcessWrapper：一个 Node 进程只持有唯一的 SemaCore，
 * 模型 / 配置 / MCP / 插件等进程级能力全进程共享；多个会话（对应 UI 多标签）
 * 通过 sessionId 复用同一个 Core。这样 gRPC 侧的使用体验与 VSCode 一致。
 */
export class SemaCoreManager {
  private core: SemaCore | null = null;
  private baseConfig: Record<string, any>;

  constructor(baseConfig: Record<string, any>) {
    this.baseConfig = { ...baseConfig };
  }

  /**
   * 首次调用创建 SemaCore；已存在时做**非破坏式**配置合并（updateCoreConfig），
   * 不再 dispose 重建 —— 避免把已存在的其它会话一起干掉。
   */
  init(overrides?: Record<string, any>): SemaCore {
    if (!this.core) {
      this.baseConfig = { ...this.baseConfig, ...(overrides ?? {}) };
      this.core = new SemaCore(this.baseConfig);
    } else if (overrides && Object.keys(overrides).length > 0) {
      this.core.updateCoreConfig(overrides);
    }
    return this.core;
  }

  /** 取 Core 实例；未初始化时报错，提示先 init（与示例调用流程一致） */
  get instance(): SemaCore {
    if (!this.core) {
      throw new Error('SemaCore 未初始化：请先发送 init');
    }
    return this.core;
  }

  isReady(): boolean {
    return this.core !== null;
  }

  // ===== 会话池（对齐 SemaProcessWrapper 的会话池方法）=====

  getSession(sessionId: string): SemaSession | undefined {
    return this.core?.getSession(sessionId);
  }

  listSessions(): string[] {
    return this.core?.listSessions() ?? [];
  }

  closeSession(sessionId: string): boolean {
    return this.core?.closeSession(sessionId) ?? false;
  }

  // ===== 进程级事件（cron / mcp 状态等，挂在 SemaCore 上）=====

  onProcessEvent(event: string, listener: (data: any) => void): void {
    (this.core as any)?.on(event, listener);
  }

  offProcessEvent(event: string, listener: (data: any) => void): void {
    (this.core as any)?.off(event, listener);
  }

  async dispose(): Promise<void> {
    try {
      await this.core?.dispose();
    } finally {
      this.core = null;
    }
  }
}
