import React, { useState, useEffect, useRef } from 'react';
import { Config, ModelProfile, VscodeApi } from './types';
import ModelList from './ModelList';
import TaskConfig from './TaskConfig';
import AddModelForm from './AddModelForm';
import SystemConfig from './SystemConfig';
import MCPConfig from './MCPConfig';
import SkillConfig from './SkillConfig';
import AgentConfig from './AgentConfig';
import HooksConfig from './HooksConfig';
import PluginConfig from './PluginConfig';
import CommandConfig from './CommandConfig';
import RuleMemoryConfig from './RuleMemoryConfig';
import BackgroundTaskConfig from './BackgroundTaskConfig';
import CronTaskConfig from './CronTaskConfig';
import DesignConfig from './DesignConfig';
import ClawConfig from './ClawConfig';
import ImportConfig from './ImportConfig';
import UsageConfig from './UsageConfig';
import { RefreshIcon } from './utils/svgIcons';
import { setLang, useT } from '../common/i18n/react';

type PageType = 'models' | 'system' | 'memory' | 'mcp' | 'skill' | 'agent' | 'hooks' | 'command' | 'plugin' | 'task' | 'design' | 'import' | 'claw' | 'usage';
type ModelTabType = 'list' | 'add';

/**
 * 扩展的几个子页 → 各自的拉取命令。新会话时 core 会重扫插件并级联刷新
 * skills/agents/commands/MCP/hooks，停在这些页上的列表已过期，重走一次各页原有的加载流程。
 */
const EXTENSION_PAGE_LOAD: Partial<Record<PageType, string>> = {
    mcp: 'loadMCPConfig',
    agent: 'loadAgentsInfo',
    command: 'loadCommandsInfo',
    skill: 'loadSkillsInfo',
    hooks: 'loadHooksInfo',
    plugin: 'loadPluginConfig',
};
type TaskTabType = 'background' | 'cron';

interface AppProps {
    vscode: VscodeApi;
}

const App: React.FC<AppProps> = ({ vscode }) => {
    // JB 插件不支持 Claw 远程，隐藏其入口（VSCode 下 __SEMA_JB__ 为 undefined，行为不变）。
    // 必须在组件内读取：模块顶层求值早于 jb-index 设置该标记，会恒为 false。
    const IS_JB = !!(window as any).__SEMA_JB__;
    const t = useT();
    const [currentPage, setCurrentPage] = useState<PageType>('models');
    const [modelTab, setModelTab] = useState<ModelTabType>('list');
    const [taskTab, setTaskTab] = useState<TaskTabType>('cron');
    const [taskRefreshTrigger, setTaskRefreshTrigger] = useState(0);
    const [backgroundTaskCount, setBackgroundTaskCount] = useState(0);
    const [cronTaskCount, setCronTaskCount] = useState(0);
    const [config, setConfig] = useState<Config | null>(null);
    const [initialTaskId, setInitialTaskId] = useState<string | undefined>(undefined);
    const [initialTaskNonce, setInitialTaskNonce] = useState(0);
    /**
     * 正在编辑的模型（唯一真源，表单不自己记编辑态）。非空时新增页锁住 provider/模型名并按其回填；
     * 点「新增模型」标签、保存成功、离开模型页三种情况都清空，保证回到新增页时是可编辑的空白表单。
     */
    const [editModel, setEditModel] = useState<ModelProfile | null>(null);
    const [editNonce, setEditNonce] = useState(0);
    const currentPageRef = useRef(currentPage);
    const taskTabRef = useRef(taskTab);
    currentPageRef.current = currentPage;
    taskTabRef.current = taskTab;

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case 'langUpdate':
                    if (typeof message.lang === 'string') setLang(message.lang);
                    break;
                case 'loadConfig':
                    // 直接设置 ModelUpdateData 格式的数据
                    setConfig(message.data);
                    // 如果没有模型，自动切换到新增模型标签页
                    if (message.showAddPage) {
                        setCurrentPage('models');
                        setModelTab('add');
                    }
                    break;
                case 'navigateTo':
                    if (message.page) {
                        setCurrentPage(message.page as PageType);
                        // 从 chat 等入口跳来的「任务管理」必定是后台任务，强制重置二级 tab，
                        // 避免停留在「定时任务」上看不到刚刚点击的后台任务
                        if (message.page === 'task') {
                            setTaskTab('background');
                        }
                    }
                    if (message.taskId) {
                        setInitialTaskId(message.taskId);
                        // 即使 taskId 与上次相同，也通过 nonce 触发详情面板重新打开
                        setInitialTaskNonce(n => n + 1);
                    }
                    break;
                case 'sessionCreated': {
                    const loadCommand = EXTENSION_PAGE_LOAD[currentPageRef.current];
                    if (loadCommand) vscode.postMessage({ command: loadCommand });
                    break;
                }
                case 'cronUpdate':
                    if (currentPageRef.current === 'task' && taskTabRef.current === 'cron') {
                        setTaskRefreshTrigger(n => n + 1);
                    }
                    break;
                case 'modelProfileResult':
                    // 列表点「编辑」：切到新增页并回填；nonce 保证连续编辑同一模型也能重新回填
                    if (message.profile) {
                        setEditModel(message.profile);
                        setEditNonce(n => n + 1);
                        setCurrentPage('models');
                        setModelTab('add');
                    }
                    break;
            }
        };

        window.addEventListener('message', handleMessage);

        vscode.postMessage({ command: 'loadConfig' });

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    // 离开模型页即退出编辑：模型页是条件渲染，回来时表单重新挂载，不能再带着编辑目标回填
    useEffect(() => {
        if (currentPage !== 'models') setEditModel(null);
    }, [currentPage]);

    const exitEditToList = () => {
        setEditModel(null);
        setModelTab('list');
    };

    // 侧栏三组导航：组名仅作标题，不可点击。Tools & MCP 等为产品术语，保持英文不走 i18n。
    // Claw 远程在 JB 下隐藏，但「更多」组名保留。
    const navGroups: { title: string; items: { page: PageType; label: string }[] }[] = [
        {
            title: t('config.nav.group.basic'),
            items: [
                { page: 'models', label: t('config.nav.models') },
                { page: 'system', label: t('config.nav.system') },
                { page: 'memory', label: t('config.nav.memory') },
                { page: 'task', label: t('config.nav.task') },
                { page: 'usage', label: t('config.nav.usage') },
            ],
        },
        {
            title: t('config.nav.group.extension'),
            items: [
                { page: 'mcp', label: 'Tools & MCP' },
                { page: 'skill', label: 'Skills' },
                { page: 'agent', label: 'Agents' },
                { page: 'plugin', label: 'Plugins' },
                { page: 'command', label: 'Commands' },
                { page: 'hooks', label: 'Hooks' },
            ],
        },
        {
            title: t('config.nav.group.more'),
            items: [
                { page: 'design', label: 'Design' },
                ...(IS_JB ? [] : [{ page: 'claw' as PageType, label: t('config.nav.claw') }]),
                { page: 'import', label: t('config.nav.import') },
            ],
        },
    ];

    return (
        <div className="app-container">
            {/* 左侧导航 */}
            <div className="sidebar">
                {navGroups.map(group => (
                    <div className="nav-group" key={group.title}>
                        <div className="nav-group-title">{group.title}</div>
                        {group.items.map(item => (
                            <div
                                key={item.page}
                                className={`nav-item nav-main ${currentPage === item.page ? 'active' : ''}`}
                                onClick={() => setCurrentPage(item.page)}
                            >
                                {item.label}
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            {/* 主内容区域 */}
            <div className="main-content">
                {/* 模型配置页面 */}
                {currentPage === 'models' && (
                    <div className="page active">
                        {/* 标签页导航 */}
                        <div className="tab-navigation">
                            <div
                                className={`tab-item ${modelTab === 'list' ? 'active' : ''}`}
                                onClick={() => setModelTab('list')}
                            >
                                {t('config.tab.modelList')}
                            </div>
                            <div
                                className={`tab-item ${modelTab === 'add' ? 'active' : ''}`}
                                onClick={() => { setEditModel(null); setModelTab('add'); }}
                            >
                                {t('config.tab.addModel')}
                            </div>
                        </div>

                        {/* 标签页内容 */}
                        <div className="tab-content">
                            <div style={{ display: modelTab === 'list' ? 'block' : 'none' }}>
                                <ModelList config={config} vscode={vscode} />
                                <TaskConfig config={config} vscode={vscode} />
                            </div>
                            <div style={{ display: modelTab === 'add' ? 'block' : 'none' }}>
                                <AddModelForm
                                    onSuccess={exitEditToList}
                                    onCancelEdit={exitEditToList}
                                    editModel={editModel}
                                    editNonce={editNonce}
                                    vscode={vscode}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* 系统配置页面 */}
                {currentPage === 'system' && (
                    <div className="page active">
                        <SystemConfig vscode={vscode} />
                    </div>
                )}

                {/* Memory页面 */}
                {currentPage === 'memory' && (
                    <div className="page active">
                        <RuleMemoryConfig vscode={vscode} />
                    </div>
                )}

                {/* MCP页面 */}
                {currentPage === 'mcp' && (
                    <div className="page active extension-page">
                        <MCPConfig vscode={vscode} onOpenSystemConfig={() => setCurrentPage('system')} />
                    </div>
                )}

                {/* 子代理页面 */}
                {currentPage === 'agent' && (
                    <div className="page active extension-page">
                        <AgentConfig vscode={vscode} />
                    </div>
                )}

                {/* command页面 */}
                {currentPage === 'command' && (
                    <div className="page active extension-page">
                        <CommandConfig vscode={vscode} />
                    </div>
                )}

                {/* Skill页面 */}
                {currentPage === 'skill' && (
                    <div className="page active extension-page">
                        <SkillConfig vscode={vscode} />
                    </div>
                )}

                {/* Hooks页面 */}
                {currentPage === 'hooks' && (
                    <div className="page active extension-page">
                        <HooksConfig vscode={vscode} />
                    </div>
                )}

                {/* Plugin页面 */}
                {currentPage === 'plugin' && (
                    <div className="page active extension-page">
                        <PluginConfig vscode={vscode} />
                    </div>
                )}

                {/* Design页面 */}
                {currentPage === 'design' && (
                    <div className="page active more-page">
                        <DesignConfig vscode={vscode} />
                    </div>
                )}

                {/* 导入页面（从 Claude Code / Codex / Cursor 导入配置） */}
                {currentPage === 'import' && (
                    <div className="page active more-page">
                        <ImportConfig vscode={vscode} />
                    </div>
                )}

                {/* 使用情况页面 */}
                {currentPage === 'usage' && (
                    <div className="page active">
                        <UsageConfig vscode={vscode} />
                    </div>
                )}

                {/* Claw 远程页面 */}
                {!IS_JB && currentPage === 'claw' && (
                    <div className="page active more-page">
                        <ClawConfig vscode={vscode} />
                    </div>
                )}

                {/* 任务管理页面 */}
                {currentPage === 'task' && (
                    <div className="page active task-management">
                        <div className="tab-navigation">
                            <div
                                className={`tab-item ${taskTab === 'cron' ? 'active' : ''}`}
                                onClick={() => setTaskTab('cron')}
                            >
                                {t('config.tab.cronTasks')}
                                {cronTaskCount > 0 && (
                                    <span className="section-tab-count">{cronTaskCount}</span>
                                )}
                            </div>
                            <div
                                className={`tab-item ${taskTab === 'background' ? 'active' : ''}`}
                                onClick={() => setTaskTab('background')}
                            >
                                {t('config.tab.backgroundTasks')}
                                {backgroundTaskCount > 0 && (
                                    <span className="section-tab-count">{backgroundTaskCount}</span>
                                )}
                            </div>
                            <div style={{ marginLeft: 'auto' }}>
                                <button
                                    className="section-icon-btn"
                                    title={t('common.refresh')}
                                    onClick={() => setTaskRefreshTrigger(n => n + 1)}
                                >
                                    <RefreshIcon size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="tab-content">
                            <div style={{ display: taskTab === 'cron' ? 'block' : 'none' }}>
                                <CronTaskConfig vscode={vscode} refreshTrigger={taskRefreshTrigger} onCountChange={setCronTaskCount} />
                            </div>
                            <div style={{ display: taskTab === 'background' ? 'block' : 'none' }}>
                                <BackgroundTaskConfig vscode={vscode} refreshTrigger={taskRefreshTrigger} onCountChange={setBackgroundTaskCount} initialTaskId={initialTaskId} initialTaskNonce={initialTaskNonce} />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
