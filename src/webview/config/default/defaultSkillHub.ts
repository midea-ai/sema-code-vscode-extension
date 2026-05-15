export const skillHubConfig = {
    searchUrl: (query: string) => `https://lightmake.site/api/v1/search?q=${encodeURIComponent(query)}`,
    downloadUrl: (slug: string) => `https://lightmake.site/api/v1/download?slug=${encodeURIComponent(slug)}`,
    homepageUrl: 'https://skillhub.tencent.com',
    defaultHint: '输入关键词搜索 SkillHub',
    sourceLabel: '信息来自',
    sourceName: 'SkillHub',
    defaultDescription: 'SkillHub 是一个开放的 Skill 共享平台，汇集了社区贡献的各类实用 Skill。你可以在这里搜索并安装适合自己工作流的 Skill，也欢迎将你的 Skill 分享给更多人。',
};
