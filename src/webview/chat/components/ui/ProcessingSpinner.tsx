import React, { useState, useEffect, useRef } from 'react';

const CHARACTERS = ['·', '✢', '✳', '∗', '✻', '✽']

const MESSAGES = [
    'Accomplishing',
    'Actioning',
    'Actualizing',
    'Baking',
    'Brewing',
    'Calculating',
    'Cerebrating',
    'Churning',
    'Coding',
    'Coalescing',
    'Cogitating',
    'Computing',
    'Conjuring',
    'Considering',
    'Cooking',
    'Crafting',
    'Creating',
    'Crunching',
    'Deliberating',
    'Determining',
    'Doing',
    'Effecting',
    'Finagling',
    'Forging',
    'Forming',
    'Generating',
    'Hatching',
    'Herding',
    'Honking',
    'Hustling',
    'Ideating',
    'Inferring',
    'Manifesting',
    'Marinating',
    'Moseying',
    'Mulling',
    'Mustering',
    'Musing',
    'Noodling',
    'Percolating',
    'Pondering',
    'Processing',
    'Puttering',
    'Reticulating',
    'Ruminating',
    'Schlepping',
    'Shucking',
    'Simmering',
    'Smooshing',
    'Spinning',
    'Stewing',
    'Synthesizing',
    'Transmuting',
    'Tinkering',
    'Vibing',
    'Working',
]

interface ProcessingSpinnerProps {
    in_progress?: string;
    next_progress?: string;
    accumulatedSeconds?: number;
}

const ProcessingSpinner: React.FC<ProcessingSpinnerProps> = ({
    in_progress = '',
    next_progress = '',
    accumulatedSeconds = 0
}) => {
    const frames = [...CHARACTERS, ...[...CHARACTERS].reverse()];
    const [frame, setFrame] = useState(0);
    const [elapsedTime, setElapsedTime] = useState(accumulatedSeconds);
    const messageRef = useRef(in_progress || MESSAGES[Math.floor(Math.random() * MESSAGES.length)] + '…') ;
    const startTimeRef = useRef(Date.now() - accumulatedSeconds * 1000);

    useEffect(() => {
        const timer = setInterval(() => {
            setFrame(f => (f + 1) % frames.length);
        }, 120);

        return () => clearInterval(timer);
    }, [frames.length]);

    useEffect(() => {
        const timer = setInterval(() => {
            setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    // 当 accumulatedSeconds 改变时，重新设置开始时间
    useEffect(() => {
        startTimeRef.current = Date.now() - accumulatedSeconds * 1000;
        setElapsedTime(accumulatedSeconds);
    }, [accumulatedSeconds]);

    // 格式化时间为 2m25s 格式
    const formatTime = (seconds: number): string => {
        if (seconds < 60) {
            return `${seconds}s`;
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m${remainingSeconds}s`;
    };

    const formatMessage = (message: string): string => {
        if (!message) return message;
        // 移除末尾的 "..." 或 "…"，然后添加 "…"
        return message.replace(/[.…]{1,3}$/, '') + '…';
    };

    const displayMessage = in_progress
        ? `${formatMessage(in_progress)}`
        : `${messageRef.current}`;

    return (
        <div className="processing-spinner">
            <div className="processing-spinner-main">
                <span className="spinner-char">{frames[frame]}</span>
                <span
                    className={`spinner-message ${in_progress ? 'custom-message' : ''}`}
                >
                    {displayMessage}
                </span>
                <span className="spinner-time-info">
                    ({formatTime(elapsedTime)}<span className="spinner-interrupt-hint"> · esc to interrupt</span>)
                </span>
            </div>
            {next_progress && (
                <div className="spinner-next-progress">
                    next: {next_progress}
                </div>
            )}
        </div>
    );
};

export default React.memo(ProcessingSpinner);