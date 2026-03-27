import React from 'react';
import { Message, FileChange } from './types';
import EditBlock from './blocks/tools/EditBlock';
import NotebookEditBlock from './blocks/tools/NotebookEditBlock';
import ReadBlock from './blocks/tools/ReadBlock';
import PubBlock from './blocks/tools/PubBlock';
import BashBlock from './blocks/tools/BashBlock';
import AgentBlock from './blocks/tools/AgentBlock';
import ToolErrorBlock from './blocks/ToolErrorBlock';
import UserInputBlock from './blocks/UserInputBlock';
import AiResponseBlock from './blocks/AiResponseBlock';
import ThoughtBlock from './blocks/ThoughtBlock';
import PermissionRequestBlock from './components/permission/PermissionRequestBlock';
import SupplementaryInfo from './components/ui/SupplementaryInfo';
import PlanImplementPanel from './components/ui/PlanImplementPanel';

interface MessageItemProps {
    message: Message;
    shouldReportChange: boolean;
    toolPermissionData: any;
    vscode: any;
    onFileChange?: (change: FileChange) => void;
    streamingContent?: { id: string; content?: string; reasoning?: string } | null;
    streamingToolContent?: { id: string; toolContent: any } | null;
}

const MessageItem: React.FC<MessageItemProps> = React.memo(({
    message,
    shouldReportChange,
    toolPermissionData,
    vscode,
    onFileChange,
    streamingContent,
    streamingToolContent
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
            case 'NotebookRead':
                return <ReadBlock content={message.content} vscode={vscode} />;
            case 'Bash': {
                const isToolStreaming = streamingToolContent?.id === message.id;
                const displayContent = isToolStreaming ? streamingToolContent!.toolContent : message.content;
                return <BashBlock content={displayContent} vscode={vscode} />;
            }
            case 'Agent':
                return (
                    <AgentBlock
                        content={message.content}
                        vscode={vscode}
                        forceClose={!!toolPermissionData}
                    />
                );
            default:
                return <PubBlock content={message.content} vscode={vscode} />;
        }
    };

    switch (message.type) {
        case 'user':
            return <UserInputBlock content={message.content} />;

        case 'assistant': {
            const isCurrentlyStreaming = streamingContent?.id === message.id;
            const displayContent = isCurrentlyStreaming
                ? (streamingContent!.content ?? message.content?.content)
                : message.content?.content;
            const displayReasoning = isCurrentlyStreaming
                ? (streamingContent!.reasoning ?? message.reasoning)
                : message.reasoning;

            const hasReasoning = !!(displayReasoning && displayReasoning.trim().length > 0);
            const hasContent = !!(displayContent && displayContent.trim().length > 0);
            const isCompleted = !isCurrentlyStreaming && !!message.content?.completed;
            const isThinking = hasReasoning && !hasContent && !isCompleted;

            return (
                <React.Fragment>
                    {hasReasoning && (
                        <ThoughtBlock
                            content={displayReasoning || ''}
                            isThinking={isThinking}
                        />
                    )}
                    {hasContent && (
                        <AiResponseBlock
                            content={displayContent!}
                            isStreaming={isCurrentlyStreaming || !message.content?.completed}
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
            }
            return null;

        default:
            return null;
    }
}, (prev, next) => {
    const baseEqual = prev.message === next.message
        && prev.shouldReportChange === next.shouldReportChange
        && prev.toolPermissionData === next.toolPermissionData;

    // 判断 streamingContent 是否与本条消息相关
    const prevStreamingIsForThis = prev.streamingContent?.id === prev.message.id;
    const nextStreamingIsForThis = next.streamingContent?.id === next.message.id;

    // 判断 streamingToolContent 是否与本条消息相关
    const prevToolStreamingIsForThis = prev.streamingToolContent?.id === prev.message.id;
    const nextToolStreamingIsForThis = next.streamingToolContent?.id === next.message.id;

    // 与本条消息无关时，忽略 streaming 变化，避免无关消息重渲染
    if (!prevStreamingIsForThis && !nextStreamingIsForThis
        && !prevToolStreamingIsForThis && !nextToolStreamingIsForThis) {
        return baseEqual;
    }

    // 与本条消息相关时，额外比较流式内容
    return baseEqual
        && prev.streamingContent?.content === next.streamingContent?.content
        && prev.streamingContent?.reasoning === next.streamingContent?.reasoning
        && prev.streamingToolContent?.toolContent === next.streamingToolContent?.toolContent;
});

MessageItem.displayName = 'MessageItem';

export default MessageItem;
