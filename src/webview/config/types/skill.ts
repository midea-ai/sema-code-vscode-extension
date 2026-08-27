export type SkillScope = 'user' | 'project' | 'plugin';

export interface SkillConfig {
    name: string;
    description: string;
    prompt: string;
    locate?: SkillScope;
    filePath?: string;
    /** 是否启用（settings 的 disabledSkills 控制；undefined 视为启用） */
    status?: boolean;
}