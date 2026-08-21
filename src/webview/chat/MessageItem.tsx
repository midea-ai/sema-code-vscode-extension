import React from 'react';
import { Message, FileChange } from './types';
import EditBlock from './blocks/tools/EditBlock';
import NotebookEditBlock from './blocks/tools/NotebookEditBlock';
import ReadBlock from './blocks/tools/ReadBlock';
import PubBlock from './blocks/tools/PubBlock';
import BashBlock from './blocks/tools/BashBlock';
import BackgroundJobBlock from './blocks/tools/BackgroundJobBlock';
import AgentBlock from './blocks/tools/AgentBlock';
import ToolErrorBlock from './blocks/ToolErrorBlock';
import UserInputBlock from './blocks/UserInputBlock';
import AiResponseBlock from './blocks/AiResponseBlock';
import ThoughtBlock from './blocks/ThoughtBlock';
import PermissionRequestBlock from './components/permission/PermissionRequestBlock';
import AskFormDialog from './components/ui/AskFormDialog';
import SupplementaryInfo from './components/ui/SupplementaryInfo';
import PlanImplementPanel from './components/ui/PlanImplementPanel';
import TaskEndBlock from './blocks/TaskEndBlock';
import { TOOL_NAME_WRITE_FILE, TOOL_NAME_PATCH_FILE, TOOL_NAME_EDIT_NOTEBOOK, TOOL_NAME_VIEW_FILE, TOOL_NAME_RUN_SHELL, TOOL_NAME_PEEK_BG_JOB } from '../../utils/tool';

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
    showThinkingText?: boolean;
    processingState?: 'idle' | 'processing';
    onFork?: (uuid: string) => void;
    isLastMessage?: boolean;
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
    showThinkingText = true,
    processingState,
    onFork,
    isLastMessage = false,
}) => {
    const renderToolContent = () => {
        switch (message.toolName) {
            case TOOL_NAME_WRITE_FILE:
            case TOOL_NAME_PATCH_FILE:
                return (
                    <EditBlock
                        content={message.content}
                        vscode={vscode}
                        onFileChange={shouldReportChange ? onFileChange : undefined}
                    />
                );
            case TOOL_NAME_EDIT_NOTEBOOK:
                return (
                    <NotebookEditBlock
                        content={message.content}
                        vscode={vscode}
                        onFileChange={shouldReportChange ? onFileChange : undefined}
                    />
                );
            case TOOL_NAME_VIEW_FILE:
                return <ReadBlock content={message.content} vscode={vscode} />;
            case TOOL_NAME_RUN_SHELL:
                return <BashBlock content={message.content} messageId={message.id} vscode={vscode} isLast={isLastMessage} />;
            case TOOL_NAME_PEEK_BG_JOB:
                return <BackgroundJobBlock content={message.content} messageId={message.id} vscode={vscode} />;
            case 'Agent':
                return (
                    <AgentBlock
                        content={message.content}
                        vscode={vscode}
                        forceClose={!!toolPermissionData}
                        externalOpen={openAgentTaskId === message.content?.taskId}
                        onExternalClose={onAgentModalClose}
                        onFileChange={shouldReportChange ? onFileChange : undefined}
                    />
                );
            default:
                return <PubBlock content={message.content} messageId={message.id} vscode={vscode} />;
        }
    };

    switch (message.type) {
        case 'user':
            return (
                <UserInputBlock
                    content={message.content}
                    attachments={message.attachments}
                    source={message.source}
                    uuid={message.uuid}
                    canFork={processingState === 'idle'}
                    onFork={onFork}
                />
            );

        case 'assistant': {
            const isCurrentlyStreaming = streamingAssistantId === message.id;
            const displayContent = message.content?.content;
            const displayReasoning = message.reasoning;

            const hasReasoning = showThinkingText && !!(displayReasoning && displayReasoning.trim().length > 0);
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
                    vscode={vscode}
                />
            );

        case 'askForm':
            return (
                <AskFormDialog
                    data={message.content.data}
                    onSubmit={() => {}}
                    onSkip={() => {}}
                    readonly
                    initialValues={message.content.values}
                    status={message.content.status}
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
            } else if (['compact', 'clear', 'session_error', 'hook_notice'].includes(message.content.type)) {
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
        && prev.openAgentTaskId === next.openAgentTaskId
        && prev.showThinkingText === next.showThinkingText
        && prev.processingState === next.processingState
        && prev.onFork === next.onFork
        && prev.isLastMessage === next.isLastMessage;

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
