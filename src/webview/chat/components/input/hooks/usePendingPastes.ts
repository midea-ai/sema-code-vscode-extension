import { useState, useRef, useCallback } from 'react';
import { VscodeApi } from '../../../types';
import { PasteAttachment, makePastePreview } from '../../../../common/paste';

// 输入框待发送的超长粘贴：粘贴那一刻就由宿主落盘为 <semaRoot>/attachments/<uuid>/pasted-text.txt，
// 这里除发送要用的 path/preview 外多存 text，供「在文本框中显示」展开回输入框
export interface PendingPaste {
    id: string;
    path: string;
    preview: string;
    text: string;
}

const SAVE_TIMEOUT_MS = 3000;

/** 等待宿主一次性回包（按 reqId 匹配），超时 resolve null */
function waitFor<T>(type: string, reqId: string, pick: (msg: any) => T): Promise<T | null> {
    return new Promise(resolve => {
        const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, SAVE_TIMEOUT_MS);
        const onMsg = (event: MessageEvent) => {
            const msg = event.data;
            if (msg?.type !== type || msg.reqId !== reqId) return;
            clearTimeout(timer);
            window.removeEventListener('message', onMsg);
            resolve(pick(msg));
        };
        window.addEventListener('message', onMsg);
    });
}

export function usePendingPastes(vscode: VscodeApi) {
    const [pastes, setPastes] = useState<PendingPaste[]>([]);
    const pastesRef = useRef<PendingPaste[]>([]);
    pastesRef.current = pastes;
    const seq = useRef(0);

    /** 落盘并入队；宿主未响应/失败返回 false，调用方退回原样插入 */
    const add = useCallback(async (text: string): Promise<boolean> => {
        const reqId = `paste-${Date.now()}-${seq.current++}`;
        vscode.postMessage({ type: 'savePastedText', text, reqId });
        const path = await waitFor<string>('pastedTextSaved', reqId, m => (typeof m.path === 'string' && m.path) ? m.path : '');
        if (!path) return false;
        setPastes(prev => [...prev, { id: reqId, path, preview: makePastePreview(text), text }]);
        return true;
    }, [vscode]);

    /** 删芯片：删掉宿主的 uuid 目录并从队列移除 */
    const remove = useCallback((id: string) => {
        const target = pastesRef.current.find(p => p.id === id);
        if (target) vscode.postMessage({ type: 'removePastedText', path: target.path });
        setPastes(prev => prev.filter(p => p.id !== id));
    }, [vscode]);

    const clear = useCallback(() => { setPastes([]); }, []);

    /** fork 回填：转存文件仍在磁盘上则按路径读回正文复用原路径；已被退场清理的跳过 */
    const setFromAttachments = useCallback(async (items: PasteAttachment[] | undefined) => {
        if (!items || items.length === 0) { setPastes([]); return; }
        const restored: PendingPaste[] = [];
        for (const p of items) {
            const reqId = `paste-read-${Date.now()}-${seq.current++}`;
            vscode.postMessage({ type: 'readPastedText', path: p.path, reqId });
            const content = await waitFor<string | null>('pastedTextRead', reqId, m => (typeof m.content === 'string' ? m.content : null));
            if (content === null) { console.warn('[paste] pasted file no longer exists, skipped:', p.path); continue; }
            restored.push({ id: reqId, path: p.path, preview: p.preview, text: content });
        }
        setPastes(restored);
    }, [vscode]);

    const toAttachments = useCallback((): PasteAttachment[] =>
        pastesRef.current.map(p => ({ path: p.path, preview: p.preview })), []);

    return { pastes, add, remove, clear, setFromAttachments, toAttachments };
}
