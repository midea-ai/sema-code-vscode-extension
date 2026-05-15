import React from 'react';

export const ExpandArrowIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 12 12">
        <path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export const TrashIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
);

export const CloseIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

export const RefreshIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
);

export const PlusIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

export const CartIcon: React.FC<{ size?: number }> = ({ size = 40 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 001.97-1.67L23 6H6" />
    </svg>
);

export const ChevronLeftIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="15 18 9 12 15 6" />
    </svg>
);

export const ChevronRightIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

export const ChevronDownIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

// CSS data URL form of ChevronDownIcon for use as <select> background-image.
// Keep visually in sync with the React component above.
export const CHEVRON_DOWN_DATA_URL = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23A0A0A0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")";

export const EditIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
);

export const GearIcon: React.FC<{ size?: number }> = ({ size = 32 }) => (
    <svg width={size} height={size} viewBox="0 0 32 32">
        <path fill="currentColor" d="M24.5 17.3c-.4-.1-.8-.3-1.1-.4 0-.7-.1-1.3-.1-2 0-.1.1-.1.1-.2.4-.2.7-.3 1.1-.5.4-.2.5-.6.4-1-.3-.7-.6-1.3-.9-2-.2-.4-.6-.6-1-.4-.4.2-.7.3-1.1.5-.1 0-.2 0-.2-.1-.2-.3-.5-.5-.7-.7-.2-.2-.5-.4-.7-.6.2-.4.3-.8.5-1.2.2-.5 0-.9-.5-1.1-.6-.1-1.3-.4-1.9-.6-.5-.2-.9 0-1.1.5-.1.4-.3.8-.4 1.1-.7 0-1.3.1-2 .1-.1 0-.1-.1-.2-.1-.2-.4-.3-.7-.5-1.1-.2-.4-.6-.5-1-.4-.7.3-1.3.6-2 .9-.4.2-.6.6-.4 1 .2.4.3.7.5 1.1 0 .1 0 .2-.1.2-.2.2-.4.3-.5.5-.3.3-.5.6-.8.9-.4-.1-.8-.3-1.1-.4-.5-.2-.9 0-1.1.5-.2.5-.5 1.2-.7 1.8-.2.6-.1.9.5 1.1.4.1.8.3 1.1.4 0 .7.1 1.3.1 2 0 .1-.1.1-.1.2-.4.2-.7.3-1.1.5-.4.2-.5.6-.4 1 .3.7.6 1.3.9 2 .2.4.6.6 1 .4.4-.2.7-.3 1.1-.5.1 0 .2 0 .2.1.2.3.5.5.7.7.2.2.5.4.7.6-.2.4-.3.8-.5 1.2-.2.5 0 .9.5 1.1.6.2 1.2.5 1.9.7.6.2.9.1 1.1-.5.1-.4.3-.8.4-1.1.7 0 1.3-.1 2-.1.1 0 .1.1.2.1.2.4.3.7.5 1.1.2.4.6.5 1 .4.7-.3 1.3-.6 2-.9.4-.2.6-.6.4-1-.2-.4-.3-.7-.5-1.1 0-.1 0-.2.1-.2.3-.2.5-.5.7-.7.2-.2.4-.5.6-.7.4.1.8.3 1.1.4.5.2.9 0 1.1-.5.2-.6.5-1.2.7-1.9.2-.5.1-.9-.5-1.1zm-7 2.1c-1.9.8-4 0-4.9-1.9-.8-1.9 0-4 1.9-4.9 1.9-.8 4 0 4.9 1.9.8 1.9 0 4-1.9 4.9z" />
    </svg>
);

export const GitHubIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
);

export const WarningCircleIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

export const GitPullIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M8.5 0.5L6.5 2.5M6.5 2.5L8.5 4.5M6.5 2.5H9.5C11.1569 2.5 12.5 3.84315 12.5 5.5V7.5M2.5 10.5C1.39543 10.5 0.5 11.3954 0.5 12.5C0.5 13.6046 1.39543 14.5 2.5 14.5C3.60457 14.5 4.5 13.6046 4.5 12.5C4.5 11.3954 3.60457 10.5 2.5 10.5ZM2.5 10.5V4.5M2.5 4.5C3.60457 4.5 4.5 3.60457 4.5 2.5C4.5 1.39543 3.60457 0.5 2.5 0.5C1.39543 0.5 0.5 1.39543 0.5 2.5C0.5 3.60457 1.39543 4.5 2.5 4.5ZM12.5 7.5C11.3954 7.5 10.5 8.39543 10.5 9.5C10.5 10.6046 11.3954 11.5 12.5 11.5C13.6046 11.5 14.5 10.6046 14.5 9.5C14.5 8.39543 13.6046 7.5 12.5 7.5Z" />
    </svg>
);

export const LinkIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M10,17.55,8.23,19.27a2.47,2.47,0,0,1-3.5-3.5l4.54-4.55a2.46,2.46,0,0,1,3.39-.09l.12.1a1,1,0,0,0,1.4-1.43A2.75,2.75,0,0,0,14,9.59a4.46,4.46,0,0,0-6.09.22L3.31,14.36a4.48,4.48,0,0,0,6.33,6.33L11.37,19A1,1,0,0,0,10,17.55ZM20.69,3.31a4.49,4.49,0,0,0-6.33,0L12.63,5A1,1,0,0,0,14,6.45l1.73-1.72a2.47,2.47,0,0,1,3.5,3.5l-4.54,4.55a2.46,2.46,0,0,1-3.39.09l-.12-.1a1,1,0,0,0-1.4,1.43,2.75,2.75,0,0,0,.23.21,4.47,4.47,0,0,0,6.09-.22l4.55-4.55A4.49,4.49,0,0,0,20.69,3.31Z"/>
    </svg>
);

export const OpenIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 3h6v6" />
        <path d="M10 14L21 3" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
);