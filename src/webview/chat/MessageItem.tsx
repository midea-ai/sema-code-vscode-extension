import React from 'react';
import { Message, FileChange } from './types';
import EditBlock from './blocks/tools/EditBlock';
import NotebookEditBlock from './blocks/tools/NotebookEditBlock';
import ReadBlock from './blocks/tools/ReadBlock';
import PubBlock from './blocks/tools/PubBlock';
import BashBlock from './blocks/tools/BashBlock';
import TaskOutputBlock from './blocks/tools/TaskOutputBlock';
import AgentBlock from './blocks/tools/AgentBlock';
import ToolErrorBlock from './blocks/ToolErrorBlock';
import UserInputBlock from './blocks/UserInputBlock';
import AiResponseBlock from './blocks/AiResponseBlock';
import ThoughtBlock from './blocks/ThoughtBlock';
import PermissionRequestBlock from './components/permission/PermissionRequestBlock';
import SupplementaryInfo from './components/ui/SupplementaryInfo';
import PlanImplementPanel from './components/ui/PlanImplementPanel';
import TaskEndBlock from './blocks/TaskEndBlock';

interface MessageItemProps {
    message: Message;
    shouldReportChange: boolean;
    toolPermissionData: any;
    vscode: any;
    onFileChange?: (change: FileChange) => void;
    streamingAssistantId?: string | null;
    streamingToolId?: string | null;
    openAgentTaskId?: string | null;
    onAgentModalClose?: () => void;
}

const MessageItem: React.FC<MessageItemProps> = React.memo(({
    message,
    shouldReportChange,
    toolPermissionData,
    vscode,
    onFileChange,
    streamingAssistantId,
    openAgentTaskId,
    onAgentModalClose,
}) => {
    const renderToolContent = () => {
        switch (message.toolName) {
            case 'Write':
            case 'Edit':
                return (
                    <EditBlock
                        content={message.content}
                        vscode={vscode}
                        onFileChange={shouldReportChange ? onFileChange : undefined}
                    />
                );
            case 'NotebookEdit':
                return (
                    <NotebookEditBlock
                        content={message.content}
                        vscode={vscode}
                        onFileChange={shouldReportChange ? onFileChange : undefined}
                    />
                );
            case 'TodoWrite':
                return null;
            case 'Read':
                return <ReadBlock content={message.content} vscode={vscode} />;
            case 'Bash':
                return <BashBlock content={message.content} messageId={message.id} vscode={vscode} />;
            case 'TaskOutput':
                return <TaskOutputBlock content={message.content} messageId={message.id} vscode={vscode} />;
            case 'Agent':
                return (
                    <AgentBlock
                        content={message.content}
                        vscode={vscode}
                        forceClose={!!toolPermissionData}
                        externalOpen={openAgentTaskId === message.content?.taskId}
                        onExternalClose={onAgentModalClose}
                    />
                );
            default:
                return <PubBlock content={message.content} messageId={message.id} vscode={vscode} />;
        }
    };

    switch (message.type) {
        case 'user':
            return <UserInputBlock content={message.content} />;

        case 'assistant': {
            const isCurrentlyStreaming = streamingAssistantId === message.id;
            const displayContent = message.content?.content;
            const displayReasoning = message.reasoning;

            const hasReasoning = !!(displayReasoning && displayReasoning.trim().length > 0);
            const isCompleted = message.content?.completed !== false;
            // 流式中即使 content 暂时为空也需要渲染 AiResponseBlock（等待 store 推送内容）
            const hasContent = isCurrentlyStreaming || !!(displayContent && displayContent.trim().length > 0);
            const isThinking = hasReasoning && !hasContent && !isCompleted;

            return (
                <React.Fragment>
                    {hasReasoning && (
                        <ThoughtBlock
                            content={displayReasoning || ''}
                            messageId={message.id}
                            isThinking={isThinking}
                        />
                    )}
                    {hasContent && (
                        <AiResponseBlock
                            content={displayContent || ''}
                            messageId={message.id}
                            isStreaming={isCurrentlyStreaming || !isCompleted}
                            vscode={vscode}
                        />
                    )}
                </React.Fragment>
            );
        }

        case 'tool':
            return renderToolContent();

        case 'permission_request':
            return (
                <PermissionRequestBlock
                    permissionData={message.content}
                />
            );

        case 'system':
            if (message.content.type === 'interrupted') {
                const USER_INTERRUPT_MESSAGE = '[Request interrupted by user]';
                if (message.content.content === USER_INTERRUPT_MESSAGE) {
                    return <SupplementaryInfo items={['interrupted']} />;
                }
                return null;
            } else if (message.content.type === 'tool_error') {
                return (
                    <ToolErrorBlock
                        toolName={message.content.toolName || ''}
                        title={message.content.title || ''}
                        content={message.content.content || ''}
                    />
                );
            } else if (['compact', 'clear', 'session_error'].includes(message.content.type)) {
                return <SupplementaryInfo items={[message.content.content]} />;
            } else if (message.content.type === 'file_reference') {
                return <SupplementaryInfo items={message.content.content || []} />;
            } else if (message.content.type === 'plan_implement') {
                return (
                    <PlanImplementPanel
                        planFilePath={message.content.planFilePath}
                        planContent={message.content.planContent}
                        vscode={vscode}
                    />
                );
            } else if (message.content.type === 'task_end') {
                return (
                    <TaskEndBlock
                        status={message.content.status}
                        summary={message.content.summary}
                    />
                );
            }
            return null;

        default:
            return null;
    }
}, (prev, next) => {
    const baseEqual = prev.message === next.message
        && prev.shouldReportChange === next.shouldReportChange
        && prev.toolPermissionData === next.toolPermissionData
        && prev.openAgentTaskId === next.openAgentTaskId;

    const prevStreamingIsForThis =
        prev.streamingAssistantId === prev.message.id ||
        prev.streamingToolId === prev.message.id;
    const nextStreamingIsForThis =
        next.streamingAssistantId === next.message.id ||
        next.streamingToolId === next.message.id;

    // 与本条消息无关：忽略 streaming 变化
    if (!prevStreamingIsForThis && !nextStreamingIsForThis) {
        return baseEqual;
    }

    // streaming 开始或结束（状态发生切换）：强制重渲染
    if (prevStreamingIsForThis !== nextStreamingIsForThis) {
        return false;
    }

    // 本条消息正在 streaming 中：内容由 store 推送，无需通过 props 重渲染
    return baseEqual;
});

MessageItem.displayName = 'MessageItem';

export default MessageItem;
