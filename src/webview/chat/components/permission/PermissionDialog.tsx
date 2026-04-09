import React from 'react';
import PermissionContent from './PermissionContent';
import PermissionOptions from './PermissionOptions';
import { ToolContent } from '../../types';
import { isNotebookType, isMcpToolType, isSkillType, getPermissionTitle } from '../../utils/permissionUtils';


interface ToolPermissionRequestData extends ToolContent {
    agentId?: string;
    options: {
        agree: string;
        allow?: string;
        refuse: string;
    };
}

interface PermissionDialogProps {
    permissionData: ToolPermissionRequestData;
    onPermissionSelect: (action: 'agree' | 'allow' | 'refuse') => void;
    onCancel?: () => void;
    vscode?: any;
}

const PermissionDialog: React.FC<PermissionDialogProps> = ({
    permissionData,
    onPermissionSelect,
    onCancel,
    vscode
}) => {
    const handleBashPermission = (action: 'agree' | 'allow' | 'refuse') => {
        onPermissionSelect(action);
    };

    // 获取对话框描述文本
    const getDescriptionText = () => {
        if (permissionData.toolName === 'Bash') {
            return 'Do you want to proceed?';
        } else if (permissionData.toolName === 'WebFetch') {
            return 'Do you want to fetch content from this URL?';
        } else if (isSkillType(permissionData.toolName)) {
            return 'Do you want to proceed?';
        } else if (isMcpToolType(permissionData.toolName)) {
            return 'Do you want to proceed?';
        } else if (isNotebookType(permissionData.toolName)) {
            // 解析操作类型: "Update Cell - ..." / "Create Cell - ..." / "Delete Cell - ..."
            if (permissionData.title.startsWith('Delete Cell')) {
                return 'Do you want to delete this notebook cell?';
            } else if (permissionData.title.startsWith('Create Cell')) {
                return 'Do you want to create this notebook cell?';
            } else {
                // Update Cell 或旧格式
                return 'Do you want to update this notebook cell?';
            }
        } else if (permissionData.toolName === 'Edit') {
            return 'Do you want to update this file?';
        } else {
            return 'Do you want to create this file?';
        }
    };

    return (
        <div className="chat-block bash-permission-block" tabIndex={0}>
            <div className="chat-block-header bash-permission-header">
                <div className="chat-block-title bash-permission-title">
                    <span className="bash-permission-title-text">
                        {permissionData.agentId && permissionData.agentId !== 'main' && (
                            <span className="bash-permission-agent-id">[{permissionData.agentId.slice(0, 4)}]</span>
                        )}{getPermissionTitle(permissionData.toolName)}
                    </span>
                    <span className="bash-permission-status">Pending</span>
                </div>
            </div>
            <div className="bash-permission-content">
                <PermissionContent
                    toolName={permissionData.toolName}
                    title={permissionData.title}
                    content={permissionData.content}
                    vscode={vscode}
                />
                <div className="bash-permission-info">
                    <div className="bash-permission-description">
                        {getDescriptionText()}
                    </div>
                </div>
                <PermissionOptions
                    options={permissionData.options}
                    onSelect={handleBashPermission}
                    onCancel={onCancel}
                />
            </div>
        </div>
    );
};

export default PermissionDialog;