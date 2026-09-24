import React, { useState, useEffect, useRef, useContext } from 'react';
import { ClockIcon, GlobeIcon, PlugIcon, QuestionBubbleIcon, WrenchIcon } from '../../components/ui/IconButton';
import { SessionContext } from '../../SessionContext';
import { ToolContent } from '../../types';
import { CONTINUATION_SYMBOL } from '../../utils/symbols';
import { streamingStore } from '../../utils/StreamingStore';
import {
    TOOL_NAME_CREATE_CRON,
    TOOL_NAME_DEL_CRON,
    TOOL_NAME_FETCH_URL,
    TOOL_NAME_LIST_CRONS,
    TOOL_NAME_PICK_OPTION,
    TOOL_NAME_SEARCH_CONTENT,
    TOOL_NAME_SEARCH_FILES,
    TOOL_NAME_SKILL,
    TOOL_NAME_STOP_BG_JOB,
} from '../../../../utils/tool';
import { getSearchRowMeta } from './utils';
import ToolRowHeader, { SearchRowHeader } from './ToolRowHeader';
import { useT } from '../../../common/i18n/react';
import { getSkillFilePath } from '../../components/input/utils/commandUtils';
import { hasTextSelection } from '../../utils/selection';
import CollapsibleContent from '../../components/ui/CollapsibleContent';

interface PubBlockProps {
    content: ToolContent;
    messageId: string;
    vscode?: any;
    isLast?: boolean;
}

const PubBlock: React.FC<PubBlockProps> = React.memo(({ content, messageId, vscode, isLast = false }) => {
    const t = useT();
    const sessionId = useContext(SessionContext);
    const streamContentRef = useRef('');
    const [streamContent, setStreamContent] = useState('');

    useEffect(() => {
        const unsub = streamingStore.subscribeTool(sessionId, messageId, (delta: string) => {
            streamContentRef.current += delta;
            setStreamContent(streamContentRef.current);
        });
        return () => {
            unsub();
            streamContentRef.current = '';
        };
    }, [messageId, sessionId]);

    // 完成后清除本地 streaming 状态，回归 props 的最终内容
    useEffect(() => {
        if (content.completed !== false) {
            streamContentRef.current = '';
            setStreamContent('');
        }
    }, [content.completed]);

    // streaming 中用本地累积的 content，完成后用 props
    const displayToolContent = (content.completed === false && streamContent)
        ? { ...content, content: (content.content || '') + streamContent }
        : content;

    const { toolName, title, summary, content: toolContent } = displayToolContent;

    // 解析工具名称：MCP 格式保留 serviceName - toolName，其他工具转为大驼峰（用于「查看全部」时的标题）
    const formatToolName = (name: string): string => {
        if (!name) return '';
        const mcpMatch = name.match(/^mcp__(.+?)__(.+)$/);
        if (mcpMatch) {
            return `${mcpMatch[1]} - ${mcpMatch[2]}`;
        }
        return name
            .split(/[_\s]+/)
            .filter(Boolean)
            .map(s => s.charAt(0).toUpperCase() + s.slice(1))
            .join('');
    };

    const toolValue = toolName === TOOL_NAME_PICK_OPTION ? 'User Response' : formatToolName(toolName);
    const isStreaming = content.completed === false;

    // 搜索行：只显示行头，不展开结果，与组内搜索行一致
    const searchMeta = (toolName === TOOL_NAME_SEARCH_FILES || toolName === TOOL_NAME_SEARCH_CONTENT)
        ? getSearchRowMeta(toolName, title, t)
        : null;

    // 行头：图标 + 动词 + 目标，与组内行同一套规格；MCP 目标只有工具名，参数（params）下沉到展开体
    const rowMeta = ((): { icon: React.ReactNode; verb: string; target?: string; params?: string } => {
        const mcpMatch = toolName.match(/^mcp__(.+?)__(.+)$/);
        if (mcpMatch) {
            return {
                icon: <PlugIcon />,
                verb: isStreaming ? t('tool.calling', { name: mcpMatch[1] }) : t('tool.called', { name: mcpMatch[1] }),
                target: mcpMatch[2],
                params: title,
            };
        }
        switch (toolName) {
            case TOOL_NAME_FETCH_URL:
                return { icon: <GlobeIcon />, verb: t('tool.fetched'), target: title };
            case TOOL_NAME_STOP_BG_JOB:
                return { icon: <WrenchIcon />, verb: t('tool.jobStop'), target: title };
            case TOOL_NAME_SKILL:
                return { icon: <WrenchIcon />, verb: t('tool.skill'), target: title };
            case TOOL_NAME_PICK_OPTION:
                return { icon: <QuestionBubbleIcon />, verb: t('tool.ask') };
            case TOOL_NAME_CREATE_CRON:
                return { icon: <ClockIcon />, verb: t('tool.cronCreate'), target: title };
            case TOOL_NAME_DEL_CRON:
                return { icon: <ClockIcon />, verb: t('tool.cronDelete'), target: title };
            case TOOL_NAME_LIST_CRONS:
                return { icon: <ClockIcon />, verb: t('tool.cronList'), target: title };
            default:
                return {
                    icon: <WrenchIcon />,
                    verb: isStreaming ? t('tool.calling', { name: toolValue }) : t('tool.called', { name: toolValue }),
                    target: title && title !== toolName ? title : undefined,
                };
        }
    })();

    // 输出文本：摘要行 + 结果，去空行；与组内结果行同一口径
    const outputText = [
        summary ? `${CONTINUATION_SYMBOL} ${summary}` : '',
        (toolContent ?? '').toString().split('\n').filter(line => line.trim()).join('\n'),
    ].filter(Boolean).join('\n');

    // 终端类工具（StopBackgroundJob）与 Shell/BackgroundJob 同一套规则：
    // 用户未手动操作过时，展开状态跟随「是否为最后一个块」；手动操作后钉住用户设的状态。
    // 其它工具只在首次渲染处于流式中时展开。
    const DEFAULT_EXPANDED_TOOLS = [TOOL_NAME_STOP_BG_JOB];
    const followsLast = DEFAULT_EXPANDED_TOOLS.includes(toolName);
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(
        followsLast ? null : (content.completed === false)
    );
    const isExpanded = manualExpanded ?? (followsLast && isLast);

    const handleToggle = () => {
        setManualExpanded(!isExpanded);
    };

    if (searchMeta) {
        return (
            <div className="chat-block chat-block--borderless pub-block">
                <SearchRowHeader meta={searchMeta} streaming={isStreaming} />
            </div>
        );
    }

    // 技能行：不展开内容，标题可点直接打开 SKILL.md。
    // 路径优先取工具结果 summary（core 直接给 SKILL.md 路径），其次查技能列表映射
    // （映射只在打开过 / 面板后才有，新开页面通常为空）；都没有时仅展示
    if (toolName === TOOL_NAME_SKILL) {
        const summaryPath = summary && /SKILL\.md$/i.test(summary.trim()) ? summary.trim() : undefined;
        const skillFilePath = summaryPath || getSkillFilePath(title) || getSkillFilePath(title.split(/\s/)[0]);
        const handleOpenSkill = skillFilePath
            ? () => {
                if (hasTextSelection() || !vscode) return;
                vscode.postMessage({ type: 'openFile', filePath: skillFilePath, line: 1 });
            }
            : undefined;
        return (
            <div className="chat-block chat-block--borderless pub-block">
                <ToolRowHeader
                    icon={rowMeta.icon}
                    streaming={isStreaming}
                    verb={rowMeta.verb}
                    target={rowMeta.target}
                    targetTitle={skillFilePath || rowMeta.target}
                    onTargetClick={handleOpenSkill}
                    onClick={handleOpenSkill}
                />
            </div>
        );
    }

    return (
        <div className="chat-block chat-block--borderless pub-block">
            <ToolRowHeader
                icon={rowMeta.icon}
                streaming={isStreaming}
                verb={rowMeta.verb}
                target={rowMeta.target}
                targetTitle={rowMeta.target}
                expandable
                isExpanded={isExpanded}
                onClick={handleToggle}
            />
            {isExpanded && (
                <div className="chat-block-content grouped-result-body">
                    {rowMeta.params && <div className="grouped-result-full">{rowMeta.params}</div>}
                    {outputText && (
                        <div className="grouped-result-output">
                            <CollapsibleContent>
                                <pre>{outputText}</pre>
                            </CollapsibleContent>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

PubBlock.displayName = 'PubBlock';

export default PubBlock;