import React, { useState, useEffect } from 'react';
import { Config, VscodeApi } from './types';
import ModelList from './ModelList';
import TaskConfig from './TaskConfig';
import AddModelForm from './AddModelForm';
import SystemConfig from './SystemConfig';
import MCPConfig from './MCPConfig';
import SkillConfig from './SkillConfig';
import AgentConfig from './AgentConfig';
import PluginConfig from './PluginConfig';
import CommandConfig from './CommandConfig';
import RuleMemoryConfig from './RuleMemoryConfig';

type PageType = 'models' | 'system' | 'memory' | 'mcp' | 'skill' | 'agent' | 'command' | 'plugin';
type ModelTabType = 'list' | 'add';

interface AppProps {
    vscode: VscodeApi;
}

const App: React.FC<AppProps> = ({ vscode }) => {
    const [currentPage, setCurrentPage] = useState<PageType>('models');
    const [modelTab, setModelTab] = useState<ModelTabType>('list');
    const [config, setConfig] = useState<Config | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case 'loadConfig':
                    // 直接设置 ModelUpdateData 格式的数据
                    setConfig(message.data);
                    // 如果没有模型，自动切换到新增模型标签页
                    if (message.showAddPage) {
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

    return (
        <div className="app-container">
            {/* 左侧导航 */}
            <div className="sidebar">
                <div
                    className={`nav-item nav-main ${currentPage === 'models' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('models')}
                >
                    模型配置
                </div>

                <div
                    className={`nav-item nav-main ${currentPage === 'system' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('system')}
                >
                    系统配置
                </div>

                <div
                    className={`nav-item nav-main ${currentPage === 'memory' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('memory')}
                >
                    Rule & Memory
                </div>

                <div
                    className={`nav-item nav-main ${currentPage === 'mcp' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('mcp')}
                >
                    Tools & MCP
                </div>

                <div
                    className={`nav-item nav-main ${currentPage === 'command' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('command')}
                >
                    Commands
                </div>

                <div
                    className={`nav-item nav-main ${currentPage === 'skill' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('skill')}
                >
                    Skills
                </div>

                <div
                    className={`nav-item nav-main ${currentPage === 'agent' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('agent')}
                >
                    Agents
                </div>

                <div
                    className={`nav-item nav-main ${currentPage === 'plugin' ? 'active' : ''}`}
                    onClick={() => setCurrentPage('plugin')}
                >
                    Plugins
                </div>
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
                                模型列表
                            </div>
                            <div
                                className={`tab-item ${modelTab === 'add' ? 'active' : ''}`}
                                onClick={() => setModelTab('add')}
                            >
                                新增模型
                            </div>
                        </div>

                        {/* 标签页内容 */}
                        <div className="tab-content">
                            <div style={{ display: modelTab === 'list' ? 'block' : 'none' }}>
                                <ModelList config={config} vscode={vscode} />
                                <TaskConfig config={config} vscode={vscode} />
                            </div>
                            <div style={{ display: modelTab === 'add' ? 'block' : 'none' }}>
                                <AddModelForm onSuccess={() => setModelTab('list')} vscode={vscode} />
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
                    <div className="page active">
                        <MCPConfig vscode={vscode} />
                    </div>
                )}

                {/* 子代理页面 */}
                {currentPage === 'agent' && (
                    <div className="page active">
                        <AgentConfig vscode={vscode} />
                    </div>
                )}

                {/* command页面 */}
                {currentPage === 'command' && (
                    <div className="page active">
                        <CommandConfig vscode={vscode} />
                    </div>
                )}

                {/* Skill页面 */}
                {currentPage === 'skill' && (
                    <div className="page active">
                        <SkillConfig vscode={vscode} />
                    </div>
                )}

                {/* Plugin页面 */}
                {currentPage === 'plugin' && (
                    <div className="page active">
                        <PluginConfig vscode={vscode} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;

