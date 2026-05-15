// Welcome.tsx
import React, { useEffect, useState } from 'react';

const HORSE_FRAMES = [
`      /\\,~~
     /(  o\\__
     \\_______\\__~
      /\\    /\\`,
`      /\\,~~~
     /(  o\\__
     \\_______\\__~~
      ||    ||`,
`      /\\,~~~~
     /(  o\\__
     \\_______\\__~~~
      \\/    \\/`,
`      /\\,~~~
     /(  o\\__
     \\_______\\__~~
      ||    ||`,
];

const TRACK_UNIT = '‿  ';
const TRACK_WIDTH = 22;
const TRACK_INDENT = '   ';
const FRAME_INTERVAL = 180;

const Welcome: React.FC = () => {
    const [frame, setFrame] = useState(0);
    const [offset, setOffset] = useState(0);

    useEffect(() => {
        const id = setInterval(() => {
            setFrame(f => (f + 1) % HORSE_FRAMES.length);
            setOffset(o => (o + 1) % TRACK_UNIT.length);
        }, FRAME_INTERVAL);
        return () => clearInterval(id);
    }, []);

    const repeated = TRACK_UNIT.repeat(
        Math.ceil((TRACK_WIDTH + TRACK_UNIT.length) / TRACK_UNIT.length)
    );
    const track = TRACK_INDENT + repeated.slice(offset, offset + TRACK_WIDTH);

    const welcomeMessage = `Sema是一个强大的 AI 驱动的终端助手，专为开发者设计。它能够理解代码库，智能编辑文件，执行命令，并自动化各种开发工作流程。

常见任务：
• 询问关于您的代码库的问题 > 介绍当前项目
• 编辑文件 > 更新 App.tsx 以...
• 运行命令 > /clear

移动面板位置：
 - 移至右侧：右键 Sema 图标 → Move To → Secondary Side Bar
 - 恢复左侧：右键面板标题 → Move To → Primary Side Bar

核心特性：
- 自然语言指令 - 通过自然语言直接驱动编程任务
- 权限控制 - 细粒度的权限管理，确保操作安全可控
- Subagent 管理 - 支持多智能体协同工作，可根据任务类型动态调度合适的子代理
- Skill 扩展机制 - 提供插件化架构，可灵活扩展 AI 编程能力
- Plan 模式任务规划 - 支持复杂任务的分解与执行规划
- MCP 协议支持 - 内置 Model Context Protocol 服务，支持工具扩展
- 多模型支持 - 兼容 Anthropic、OpenAI SDK，支持国内外主流厂商 LLM API
`;

    return (
        <div className="welcome-container">
            <div className="welcome-header">
                <span className="welcome-icon">🚀</span>
                <span className="welcome-title">欢迎使用 SemaCode</span>
            </div>
            <div className="welcome-message">
                <div
                    aria-hidden="true"
                    style={{ textAlign: 'center', margin: '0 0 12px 0' }}
                >
                    <pre
                        className="welcome-horse-anim"
                        style={{
                            display: 'inline-block',
                            textAlign: 'left',
                            fontFamily: 'var(--vscode-editor-font-family, monospace)',
                            fontSize: '12px',
                            lineHeight: 1.1,
                            margin: 0,
                            opacity: 0.85,
                            whiteSpace: 'pre',
                            userSelect: 'none',
                        }}
                    >{HORSE_FRAMES[frame] + '\n' + track}</pre>
                </div>
                <a
                    href="https://github.com/midea-ai/sema-code-core"
                    className="welcome-version-badge"
                    title="sema-code-core"
                >
                    <img
                        src="https://img.shields.io/npm/v/sema-core?label=sema-core&style=flat-square"
                        alt="sema-core version"
                    />
                </a>

                {welcomeMessage.split('\n').map((line, index) => (
                    <div key={index} className="welcome-line">
                        {line.trim() === '' ? (
                            <br />
                        ) : line.startsWith('Sema') ? (
                            <span className="welcome-intro-text">{line}</span>
                        ) : line.startsWith('•') ? (
                            <span className="command-text">{line}</span>
                        ) : (
                            line
                        )}
                    </div>
                ))}
            </div>
            <div className="welcome-footer">
                <span className="hint-text">下滑查看更多帮助信息</span>
            </div>
        </div>
    );
};

export default Welcome;
