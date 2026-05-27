import React, { useState } from 'react';
import PermissionContent from './PermissionContent';
import { ToggleIcon } from '../../components/ui/IconButton';
import { getPermissionTitle } from '../../utils/permissionUtils';

interface PermissionRequestData {
    toolName: string;
    title: string;
    content: string | any;
    action: 'refuse' | 'interrupted';
    refuseMessage?: string;
}

interface PermissionRequestBlockProps {
    permissionData: PermissionRequestData;
    vscode?: any;
}

const PermissionRequestBlock: React.FC<PermissionRequestBlockProps> = ({ permissionData, vscode }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    // 获取状态文本和样式类
    const getStatusInfo = () => {
        if (permissionData.action === 'refuse') {
            return { text: 'Refused', className: 'refused' };
        } else if (permissionData.action === 'interrupted') {
            return { text: 'Interrupted', className: 'interrupted' };
        }
        return { text: 'Unknown', className: '' };
    };

    const handleToggle = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div className="chat-block bash-permission-block" tabIndex={0}>
            <div className="chat-block-header bash-permission-header" onClick={handleToggle}>
                <div className="chat-block-title bash-permission-title">
                    <span className="chat-block-title-label">
                        {getPermissionTitle(permissionData.toolName)}
                    </span>
                    <div className="bash-toggle-btn">
                        <ToggleIcon isExpanded={isExpanded} />
                    </div>
                    <span className={`bash-permission-status ${getStatusInfo().className}`}>{getStatusInfo().text}</span>
                </div>
            </div>
            {isExpanded && (
                <div className="bash-permission-content permission-content-dimmed">
                    <PermissionContent
                        toolName={permissionData.toolName}
                        title={permissionData.title}
                        content={permissionData.content}
                        vscode={vscode}
                    />
                    {permissionData.refuseMessage && (
                        <div className="bash-permission-refuse-message">
                            <strong>User said：</strong>{permissionData.refuseMessage}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default React.memo(PermissionRequestBlock);