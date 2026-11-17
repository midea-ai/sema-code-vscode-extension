/**
 * 欢迎页顶部跑马灯的内容定义 —— 换内容、下线、重新推送都只改这一个文件。
 *
 * - 改内容：改 content 里对应语言的文本
 * - 下线：把 WELCOME_TIP 改成 null
 * - 「不再显示」按 id 记：换 id 后，已关闭过旧内容的用户会重新看到；只改文字不换 id 则不会
 *
 * content 是行内 markdown，只认两种语法，其余按纯文本显示：
 *   `命令`        → 高亮
 *   [文字](链接)  → 可点击链接
 * zh / en 必填，其他语言可缺，缺的回退英文。
 */
import type { Language } from '../common/i18n/core';

export interface WelcomeTipDef {
    id: string;
    content: { zh: string; en: string } & Partial<Record<Language, string>>;
}

const SEMAWORK_RELEASE = 'https://github.com/midea-ai/sema-code-core/releases/tag/SemaWork';

export const WELCOME_TIP: WelcomeTipDef | null = {
    id: 'semawork',
    content: {
        zh: `试试 SemaWork：\`npm i -g sema-code-ui\` 安装，运行 \`sema-ui\` 启动，查看[详情](${SEMAWORK_RELEASE})`,
        en: `Try SemaWork: install with \`npm i -g sema-code-ui\`, run \`sema-ui\` to start. See [details](${SEMAWORK_RELEASE})`,
        de: `SemaWork ausprobieren: mit \`npm i -g sema-code-ui\` installieren, mit \`sema-ui\` starten. Siehe [Details](${SEMAWORK_RELEASE})`,
        fr: `Essayez SemaWork : installez avec \`npm i -g sema-code-ui\`, lancez \`sema-ui\` pour démarrer. Voir les [détails](${SEMAWORK_RELEASE})`,
        it: `Prova SemaWork: installa con \`npm i -g sema-code-ui\`, esegui \`sema-ui\` per avviare. Vedi i [dettagli](${SEMAWORK_RELEASE})`,
    },
};
