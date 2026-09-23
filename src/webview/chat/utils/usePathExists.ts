/**
 * 批量确认路径是否存在（用户气泡里的 @ 引用只有确认存在才显示为芯片）。
 * 复用宿主已有的 verifyFilePath / filePathVerified 通道（tempId 前缀 ref-check-，与 markdown 的 file-check- 互不干扰），
 * 模块级缓存 + 进行中去重；paths 按内容比较，调用方不必 memo。
 */
import { useEffect, useState } from 'react';
import { VscodeApi } from '../types';

export interface PathStat { exists: boolean; isDirectory: boolean }

const cache = new Map<string, PathStat>();
const pending = new Map<string, Set<() => void>>();
let seq = 0;
let listening = false;

function ensureListener() {
    if (listening) return;
    listening = true;
    window.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data;
        if (msg?.type !== 'filePathVerified' || typeof msg.tempId !== 'string' || !msg.tempId.startsWith('ref-check-')) return;
        const path = String(msg.filePath || '');
        const isDirectory = !!msg.isDirectory;
        cache.set(path, { exists: !!msg.exists || isDirectory, isDirectory });
        const subs = pending.get(path);
        pending.delete(path);
        subs?.forEach(fn => fn());
    });
}

export function usePathExists(vscode: VscodeApi | undefined, paths: string[]): (path: string) => PathStat | undefined {
    const [, bump] = useState(0);
    const key = paths.join('\n');

    useEffect(() => {
        if (!vscode || paths.length === 0) return;
        ensureListener();
        let alive = true;
        const notify = () => { if (alive) bump(n => n + 1); };
        for (const p of paths) {
            if (cache.has(p)) continue;
            let subs = pending.get(p);
            if (!subs) {
                subs = new Set();
                pending.set(p, subs);
                vscode.postMessage({ type: 'verifyFilePath', filePath: p, tempId: `ref-check-${++seq}`, originalCode: p });
            }
            subs.add(notify);
        }
        return () => {
            alive = false;
            for (const p of paths) pending.get(p)?.delete(notify);
        };
    }, [vscode, key]); // eslint-disable-line react-hooks/exhaustive-deps

    return (path: string) => cache.get(path);
}
