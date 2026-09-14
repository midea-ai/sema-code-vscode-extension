import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MCPServerConfig, MCPServerInfo, SkillConfig } from 'sema-core/types';
import type { SemaProcessWrapper } from '../core/semaProcessWrapper';

const SKILL_NAME = 'chrome-use';
const MCP_NAME = 'chrome';
const CONFIG_KEY = 'enableBrowserControl';

/**
 * 浏览器控制开关：开时补齐用户级 chrome-use skill 与用户级 chrome MCP，关时删除两者。
 *
 * - skill：core 没有「新增 skill」接口，由插件把 assets/chrome/skills/chrome-use/ 拷到 ~/.sema/skills/ 后 refresh；删除走 removeSkillConf（删目录 + 清缓存 + 清 settings.disabledSkills）。
 * - MCP：增删都走 core 的 addMCPServer / removeMCPServer（写 json、清 settings、断开 client）。
 * - 配置键 enableBrowserControl 只在动作全部成功后写入；任一步失败不回滚（动作幂等，重试即补齐）。
 * - 所有动作经一条 promise 链串行化：core 的两个 remove 都先查内存缓存，add / 拷目录后的 refresh 是异步的，
 *   快速点两下若不串行，remove 会因缓存里还没有该项而空转，文件里的项就残留了。
 */
export class BrowserControlManager {
    private chain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly coreManager: SemaProcessWrapper,
        private readonly extensionPath: string
    ) {}

    /** 执行开/关动作，串行化；返回动作完成后的开关值（失败则抛错，配置键保持原值） */
    public setEnabled(enabled: boolean): Promise<boolean> {
        const run = () => (enabled ? this.enable() : this.disable());
        const task = this.chain.then(run, run);
        this.chain = task.catch(() => undefined);
        return task;
    }

    private get assetsDir(): string {
        return path.join(this.extensionPath, 'assets', 'chrome');
    }

    private get userSkillDir(): string {
        return path.join(os.homedir(), '.sema', 'skills', SKILL_NAME);
    }

    private async enable(): Promise<boolean> {
        // 1. 用户级 skill 目录没有就整目录拷贝
        if (!fs.existsSync(path.join(this.userSkillDir, 'SKILL.md'))) {
            fs.mkdirSync(path.dirname(this.userSkillDir), { recursive: true });
            fs.cpSync(path.join(this.assetsDir, 'skills', SKILL_NAME), this.userSkillDir, { recursive: true });
        }
        // 2. 让 core 重新扫描 skills，把新目录加载进缓存
        await this.coreManager.getSkillsInfo(true);
        // 3. 用户级没有 chrome MCP 就按模板添加
        const servers = await this.coreManager.getMCPServerInfo();
        if (!this.findUserMcp(servers)) {
            const template = JSON.parse(fs.readFileSync(path.join(this.assetsDir, 'mcp.json'), 'utf8'));
            const entry = template?.mcpServers?.[MCP_NAME];
            if (!entry) throw new Error(`assets/chrome/mcp.json 缺少 mcpServers.${MCP_NAME}`);
            const config: MCPServerConfig = { ...entry, name: MCP_NAME, scope: 'user' };
            await this.coreManager.addMCPServer(config);
        }
        // 4. 三步全部完成后才落配置键
        await this.coreManager.saveLocalSystemConfigByKey(CONFIG_KEY, true);
        return true;
    }

    private async disable(): Promise<boolean> {
        // 1. 只删用户级 chrome MCP；项目级同名项不动
        const servers = await this.coreManager.getMCPServerInfo();
        if (this.findUserMcp(servers)) {
            await this.coreManager.removeMCPServer(MCP_NAME);
        }
        // 2. 只删用户级 chrome-use skill
        const skills = await this.coreManager.getSkillsInfo();
        if (this.findUserSkill(skills)) {
            await this.coreManager.removeSkillConf(SKILL_NAME);
        }
        await this.coreManager.saveLocalSystemConfigByKey(CONFIG_KEY, false);
        return false;
    }

    private findUserMcp(servers: MCPServerInfo[]): MCPServerInfo | undefined {
        return servers.find(s => s.config.name === MCP_NAME && (s.scope ?? s.config.scope) === 'user');
    }

    private findUserSkill(skills: SkillConfig[]): SkillConfig | undefined {
        return skills.find(s => s.name === SKILL_NAME && s.locate === 'user');
    }
}
