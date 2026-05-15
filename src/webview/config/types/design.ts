export interface DesignSkillInfo {
    folderName: string;
    filePath: string;
    name: string;
    description: string;
}

export interface DesignSystemColor {
    key: string;
    value: string;
}

export interface DesignSystemInfo {
    folderName: string;
    filePath?: string;
    name: string;
    description: string;
    swatches?: DesignSystemColor[];
    colors: DesignSystemColor[];
}
