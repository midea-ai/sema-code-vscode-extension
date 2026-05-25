export const formatSearchTitle = (title: string): string => {
    const match = title.match(/^pattern:\s*"([^"]*)"(?:,?\s*path:\s*"([^"]*)")?$/);
    if (match) {
        return match[2] ? `"${match[1]}" in ${match[2]}` : `"${match[1]}"`;
    }
    return title;
};
