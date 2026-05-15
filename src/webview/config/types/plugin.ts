export type PluginTabType = 'installed' | 'market';

export type PluginScope = 'local' | 'project' | 'user';

export interface PluginSource {
    source: 'github' | 'directory';
    repo?: string;
    path?: string;
}

export interface AvailablePlugin {
    name: string;
    description: string;
    author: string;
}

export interface MarketplaceInfo {
    name: string;
    source: PluginSource;
    lastUpdated: string;
    available: AvailablePlugin[];
    installed: string[];
}

export interface PluginComponentEntry {
    name: string;
    filePath: string;
}

export interface PluginComponents {
    commands: PluginComponentEntry[];
    agents: PluginComponentEntry[];
    skills: PluginComponentEntry[];
    mcp: PluginComponentEntry[]
}

export interface PluginInfo {
    name: string;
    marketplace: string;
    scope: PluginScope;
    status: boolean;
    version?: string;
    description?: string;
    author?: string;
    components: PluginComponents;
}

export interface MarketplacePluginsInfo {
    marketplaces: MarketplaceInfo[];
    plugins: PluginInfo[];
}
