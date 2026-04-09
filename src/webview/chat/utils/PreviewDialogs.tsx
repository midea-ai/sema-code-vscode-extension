import React, { useState, useCallback } from 'react';
import { mockDialogMap, getPreviewDialogKeys } from './mockMessages';
import ProcessingSpinner from '../components/ui/ProcessingSpinner';
import ModelConfigReminder from '../components/ui/ModelConfigReminder';
import PermissionDialog from '../components/permission/PermissionDialog';
import AskQuestionDialog from '../components/ui/AskQuestionDialog';
import PlanExitDialog from '../components/ui/PlanExitDialog';
import BtwDialog from '../components/ui/BtwDialog';

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
            {show('ProcessingSpinner') && (
                <ProcessingSpinner {...mockDialogMap.ProcessingSpinner} />
            )}
            {show('ModelConfigReminder') && (
                <ModelConfigReminder
                    {...mockDialogMap.ModelConfigReminder}
                    onClose={() => dismiss('ModelConfigReminder', 'onClose')}
                    onOpenConfig={() => dismiss('ModelConfigReminder', 'onOpenConfig')}
                />
            )}
            {show('BtwDialog') && (
                <BtwDialog data={mockDialogMap.BtwDialog.data} onClose={() => dismiss('BtwDialog', 'onClose')} />
            )}
            {show('PermissionDialog') && (
                <PermissionDialog
                    permissionData={mockDialogMap.PermissionDialog.data}
                    onPermissionSelect={(action) => dismiss('PermissionDialog', 'onPermissionSelect', action)}
                    onCancel={() => dismiss('PermissionDialog', 'onCancel')}
                    vscode={vscode}
                />
            )}
            {show('AskQuestionDialog') && (
                <AskQuestionDialog
                    data={mockDialogMap.AskQuestionDialog.data}
                    onSubmit={(answers) => dismiss('AskQuestionDialog', 'onSubmit', answers)}
                    onCancel={() => dismiss('AskQuestionDialog', 'onCancel')}
                />
            )}
            {show('PlanExitDialog') && (
                <PlanExitDialog
                    data={mockDialogMap.PlanExitDialog.data}
                    onSubmit={(selected) => dismiss('PlanExitDialog', 'onSubmit', selected)}
                    onCancel={() => dismiss('PlanExitDialog', 'onCancel')}
                    vscode={vscode}
                />
            )}
        </>
    );
};

export default PreviewDialogs;
