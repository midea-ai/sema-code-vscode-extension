import React from 'react';
import PermissionContent from './PermissionContent';
import { getPermissionTitle, getResponseDot } from '../../utils/permissionUtils';

interface PermissionRequestData {
    toolName: string;
    title: string;
    content: string | any;
    action: 'refuse' | 'interrupted';
    refuseMessage?: string;
}

interface PermissionRequestBlockProps {
    permissionData: PermissionRequestData;
}

const PermissionRequestBlock: React.FC<PermissionRequestBlockProps> = ({ permissionData }) => {

    // 获取状态文本和样式类
    const getStatusInfo = () => {
        if (permissionData.action === 'refuse') {
            return { text: 'Refused', className: 'refused' };
        } else if (permissionData.action === 'interrupted') {
            return { text: 'Interrupted', className: 'interrupted' };
        }
        return { text: 'Unknown', className: '' };
    };

    return (
        <div className="bash-permission-block" tabIndex={0}>
            <div className="bash-permission-header">
                <div className="bash-permission-title">
                    <span className="bash-permission-dot dot-red">{getResponseDot()}</span>
                    <span className="bash-permission-title-text">
                        {getPermissionTitle(permissionData.toolName)}
                    </span>
                    <span className={`bash-permission-status ${getStatusInfo().className}`}>{getStatusInfo().text}</span>
                </div>
            </div>
            <div className="bash-permission-content permission-content-dimmed">
                <PermissionContent
                    toolName={permissionData.toolName}
                    title={permissionData.title}
                    content={permissionData.content}
                />
                {permissionData.refuseMessage && (
                    <div className="bash-permission-refuse-message">
                        <strong>User said：</strong>{permissionData.refuseMessage}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PermissionRequestBlock;