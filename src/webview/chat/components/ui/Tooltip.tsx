import React, { useState, ReactNode, useRef, useEffect } from 'react';

interface TooltipProps {
    content: string;
    children: ReactNode;
    className?: string;
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, className = '' }) => {
    const [show, setShow] = useState(false);
    const [position, setPosition] = useState<'left' | 'center' | 'right'>('center');
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const autoHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const isShowingRef = useRef(false);
    const prevContentRef = useRef<string>(content);

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            if (autoHideTimeoutRef.current) {
                clearTimeout(autoHideTimeoutRef.current);
            }
        };
    }, []);

    // 监听content变化，当content变为空时立即隐藏tooltip并清除所有延时
    useEffect(() => {
        const isEmpty = !content || content.trim() === '';
        const wasEmpty = !prevContentRef.current || prevContentRef.current.trim() === '';

        // 如果content从有内容变为空内容，立即清除所有延时并隐藏tooltip
        // 注意：无论show是什么状态都要清除延时，防止延时触发后tooltip显示
        if (!wasEmpty && isEmpty) {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            if (autoHideTimeoutRef.current) {
                clearTimeout(autoHideTimeoutRef.current);
                autoHideTimeoutRef.current = null;
            }
            setShow(false);
            isShowingRef.current = false;
        }

        prevContentRef.current = content;
    }, [content]);

    // 检测tooltip位置
    const detectPosition = (): 'left' | 'center' | 'right' => {
        if (!wrapperRef.current) return 'center';

        const rect = wrapperRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        
        // 定义边缘阈值（像素）
        const LEFT_THRESHOLD = 100;
        const RIGHT_THRESHOLD = 100;

        if (rect.left < LEFT_THRESHOLD) {
            return 'left';
        } else if (rect.right > viewportWidth - RIGHT_THRESHOLD) {
            return 'right';
        } else {
            return 'center';
        }
    };

    const handleMouseEnter = () => {
        // 如果已经在显示状态，不重复处理
        if (isShowingRef.current) {
            return;
        }
        
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // 延迟 0.3 秒后显示 tooltip
        timeoutRef.current = setTimeout(() => {
            isShowingRef.current = true;
            // 检测位置并显示tooltip
            const newPosition = detectPosition();
            setPosition(newPosition);
            setShow(true);

            // 设置3秒后自动隐藏
            autoHideTimeoutRef.current = setTimeout(() => {
                setShow(false);
                isShowingRef.current = false;
            }, 3000);
        }, 300);
    };

    const handleMouseLeave = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        if (autoHideTimeoutRef.current) {
            clearTimeout(autoHideTimeoutRef.current);
        }

        isShowingRef.current = false;
        timeoutRef.current = setTimeout(() => {
            setShow(false);
        }, 50);
    };

    if (!content || content.trim() === '') {
        return <>{children}</>;
    }

    // 构建完整的className
    const positionClass = position === 'left' ? 'tooltip-left' : position === 'right' ? 'tooltip-right' : '';
    const fullClassName = `tooltip-wrapper ${positionClass} ${className}`.trim();

    return (
        <div
            ref={wrapperRef}
            className={fullClassName}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {children}
            {show && (
                <div className="tooltip-content">{content}</div>
            )}
        </div>
    );
};

export default Tooltip;

