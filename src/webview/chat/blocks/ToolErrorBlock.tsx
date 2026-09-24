import React from 'react';
import { ToolErrorRow } from './tools/GroupedToolBlock';

interface ToolErrorBlockProps {
    toolName: string;
    title: string;
    content: string;
}

/** 单条工具执行错误：与组内失败行同一样式（红色叉号 + xx失败 + 标题），展开后显示报错信息 */
const ToolErrorBlock: React.FC<ToolErrorBlockProps> = React.memo(({ toolName, title, content }) => (
    <ToolErrorRow toolName={toolName} title={title} content={content} />
));

ToolErrorBlock.displayName = 'ToolErrorBlock';

export default ToolErrorBlock;
