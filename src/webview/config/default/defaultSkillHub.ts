export const skillHubConfig = {
    searchUrl: (query: string) => `https://lightmake.site/api/v1/search?q=${encodeURIComponent(query)}`,
    downloadUrl: (slug: string) => `https://lightmake.site/api/v1/download?slug=${encodeURIComponent(slug)}`,
    homepageUrl: 'https://skillhub.tencent.com',
    sourceName: 'SkillHub',
    // 提示语 / 来源前缀 / 平台介绍改走字典：config.skill.hubHint / hubSourceLabel / hubDescription（渲染期 t() 取值）
};
