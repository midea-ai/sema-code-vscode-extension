import React from 'react';

interface BaseBashContentProps {
    command: string;
    className?: string;
    style?: React.CSSProperties;
}

const BaseBashContent: React.FC<BaseBashContentProps> = ({
    command,
    className = "bash-command",
    style
}) => {
    return (
        <div className={className} style={style}>
            <pre><code className="language-bash">{command}</code></pre>
        </div>
    );
};

export default BaseBashContent;