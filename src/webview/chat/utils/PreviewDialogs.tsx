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
            {show('BtwDialog') && mockDialogMap.BtwDialog.map((item, i) => (
                <BtwDialog key={`BtwDialog-${i}`} data={item.data} onClose={() => dismiss('BtwDialog', 'onClose')} />
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
            {show('AskQuestionDialog') && mockDialogMap.AskQuestionDialog.map((item, i) => (
                <AskQuestionDialog
                    key={`AskQuestionDialog-${i}`}
                    data={item.data}
                    onSubmit={(answers) => dismiss('AskQuestionDialog', 'onSubmit', answers)}
                    onCancel={() => dismiss('AskQuestionDialog', 'onCancel')}
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
        </>
    );
};

export default PreviewDialogs;
