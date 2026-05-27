import React, { useState, useCallback } from 'react';
import { mockDialogMap, getPreviewDialogKeys } from './mockMessages';
import ProcessingSpinner from '../components/ui/ProcessingSpinner';
import ModelConfigReminder from '../components/ui/ModelConfigReminder';
import PermissionDialog from '../components/permission/PermissionDialog';
import AskFormDialog from '../components/ui/AskFormDialog';
import PlanExitDialog from '../components/ui/PlanExitDialog';
import QuickChatDialog from '../components/ui/QuickChatDialog';
import ForkDialog from '../components/ui/ForkDialog';

const log = (name: string, action: string, ...args: any[]) =>
    console.log(`[Preview] ${name}.${action}`, ...args);

const PreviewDialogs: React.FC<{ vscode: any }> = ({ vscode }) => {
    const keys = getPreviewDialogKeys();
    const [closed, setClosed] = useState<Set<string>>(new Set());

    const dismiss = useCallback((name: string, action: string, ...args: any[]) => {
        log(name, action, ...args);
        setClosed(prev => new Set(prev).add(name));
    }, []);

    if (keys.length === 0) return null;

    const show = (k: string) => keys.includes(k) && !closed.has(k);

    return (
        <>
            {show('ProcessingSpinner') && mockDialogMap.ProcessingSpinner.map((item, i) => (
                <ProcessingSpinner key={`ProcessingSpinner-${i}`} {...item} />
            ))}
            {show('ModelConfigReminder') && mockDialogMap.ModelConfigReminder.map((item, i) => (
                <ModelConfigReminder
                    key={`ModelConfigReminder-${i}`}
                    {...item}
                    onClose={() => dismiss('ModelConfigReminder', 'onClose')}
                    onOpenConfig={() => dismiss('ModelConfigReminder', 'onOpenConfig')}
                />
            ))}
            {show('QuickChatDialog') && mockDialogMap.QuickChatDialog.map((item, i) => (
                <QuickChatDialog key={`QuickChatDialog-${i}`} data={item.data} onClose={() => dismiss('QuickChatDialog', 'onClose')} />
            ))}
            {show('PermissionDialog') && mockDialogMap.PermissionDialog.map((item, i) => (
                <PermissionDialog
                    key={`PermissionDialog-${i}`}
                    permissionData={item.data}
                    onPermissionSelect={(action) => dismiss('PermissionDialog', 'onPermissionSelect', action)}
                    onCancel={() => dismiss('PermissionDialog', 'onCancel')}
                    vscode={vscode}
                />
            ))}
            {show('WebFetchPermissionDialog') && mockDialogMap.WebFetchPermissionDialog.map((item, i) => (
                <PermissionDialog
                    key={`WebFetchPermissionDialog-${i}`}
                    permissionData={item.data}
                    onPermissionSelect={(action) => dismiss('WebFetchPermissionDialog', 'onPermissionSelect', action)}
                    onCancel={() => dismiss('WebFetchPermissionDialog', 'onCancel')}
                    vscode={vscode}
                />
            ))}
            {show('McpToolPermissionDialog') && mockDialogMap.McpToolPermissionDialog.map((item, i) => (
                <PermissionDialog
                    key={`McpToolPermissionDialog-${i}`}
                    permissionData={item.data}
                    onPermissionSelect={(action) => dismiss('McpToolPermissionDialog', 'onPermissionSelect', action)}
                    onCancel={() => dismiss('McpToolPermissionDialog', 'onCancel')}
                    vscode={vscode}
                />
            ))}
            {show('SkillPermissionDialog') && mockDialogMap.SkillPermissionDialog.map((item, i) => (
                <PermissionDialog
                    key={`SkillPermissionDialog-${i}`}
                    permissionData={item.data}
                    onPermissionSelect={(action) => dismiss('SkillPermissionDialog', 'onPermissionSelect', action)}
                    onCancel={() => dismiss('SkillPermissionDialog', 'onCancel')}
                    vscode={vscode}
                />
            ))}
            {show('AskFormDialog') && mockDialogMap.AskFormDialog.map((item, i) => (
                <AskFormDialog
                    key={`AskFormDialog-${i}`}
                    data={item.data}
                    onSubmit={(answers, values) => dismiss('AskFormDialog', 'onSubmit', answers, values)}
                    onSkip={(answers, values) => dismiss('AskFormDialog', 'onSkip', answers, values)}
                    onCancel={() => dismiss('AskFormDialog', 'onCancel')}
                />
            ))}
            {show('PlanExitDialog') && mockDialogMap.PlanExitDialog.map((item, i) => (
                <PlanExitDialog
                    key={`PlanExitDialog-${i}`}
                    data={item.data}
                    onSubmit={(selected) => dismiss('PlanExitDialog', 'onSubmit', selected)}
                    onCancel={() => dismiss('PlanExitDialog', 'onCancel')}
                    vscode={vscode}
                />
            ))}
            {show('ForkDialog') && mockDialogMap.ForkDialog.map((item, i) => (
                <ForkDialog
                    key={`ForkDialog-${i}`}
                    preview={item.preview}
                    onConfirm={(restoreFiles) => dismiss('ForkDialog', 'onConfirm', restoreFiles)}
                    onCancel={() => dismiss('ForkDialog', 'onCancel')}
                />
            ))}
        </>
    );
};

export default PreviewDialogs;
