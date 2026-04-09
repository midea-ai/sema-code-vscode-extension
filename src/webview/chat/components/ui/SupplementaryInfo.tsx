import React from 'react';
import { CONTINUATION_SYMBOL } from '../../utils/symbols';

interface SupplementaryInfoProps {
    items: string[];
}

const SupplementaryInfo: React.FC<SupplementaryInfoProps> = ({ items }) => {
    if (!items || items.length === 0) {
        return null;
    }

    return (
        <div className="chat-block chat-block--borderless supplementary-info">
            {items.map((content, index) => (
                <div key={index} className="supplementary-info-item">
                    {CONTINUATION_SYMBOL} {content}
                </div>
            ))}
        </div>
    );
};

export default SupplementaryInfo;
