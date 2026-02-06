import React from 'react';

interface IconProps {
    className?: string;
}

// 1. Elena (White Female) - Soft wavy hair, gentle features
export const IconElena = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        {/* Outline */}
        <path d="M32 12C38 12 44 18 44 26C44 34 38 42 32 42C26 42 20 34 20 26C20 18 26 12 32 12Z" strokeLinecap="round" strokeLinejoin="round" />
        {/* Hair - Wavy */}
        <path d="M16 26C16 16 24 8 32 8C40 8 48 16 48 26" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M48 26C52 32 48 44 44 48" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 26C12 32 16 44 20 48" strokeLinecap="round" strokeLinejoin="round" />
        {/* Shoulders */}
        <path d="M16 56C16 56 20 54 32 54C44 54 48 56 48 56" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 2. Naomi (Black Female) - Sleek bun, sharp features, long neck
export const IconNaomi = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        {/* Face - Sharp chin */}
        <path d="M22 28C22 28 24 40 32 42C40 40 42 28 42 28" strokeLinecap="round" strokeLinejoin="round" />
        {/* Hair - Sleek bun */}
        <circle cx="32" cy="14" r="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 28C22 20 26 18 32 18C38 18 42 20 42 28" strokeLinecap="round" strokeLinejoin="round" />
        {/* Shoulders - Elegant */}
        <path d="M16 56C16 56 22 52 32 52C42 52 48 56 48 56" strokeLinecap="round" strokeLinejoin="round" />
        {/* Earrings */}
        <path d="M22 34L22 38" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M42 34L42 38" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 3. Julian (White Male) - Short hair, minimal, relaxed
export const IconJulian = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        {/* Face */}
        <path d="M22 24V32C22 38 26 42 32 42C38 42 42 38 42 32V24" strokeLinecap="round" strokeLinejoin="round" />
        {/* Hair - Classic side part */}
        <path d="M20 24C20 16 26 12 32 12C38 12 44 16 44 24" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38 12L36 18" strokeLinecap="round" strokeLinejoin="round" />
        {/* Shoulders - Broad */}
        <path d="M12 56L18 50C22 48 42 48 46 50L52 56" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 4. Marcus (Black Male) - Beard, flat top/short fade, strong jaw
export const IconMarcus = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        {/* Face & Jaw */}
        <path d="M22 26V34C22 34 24 44 32 44C40 44 42 34 42 34V26" strokeLinecap="round" strokeLinejoin="round" />
        {/* Beard indication */}
        <path d="M24 38C26 40 29 41 32 41C35 41 38 40 40 38" strokeLinecap="round" strokeLinejoin="round" />
        {/* Hair - Sharp fade */}
        <rect x="22" y="16" width="20" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Shoulders - Structured suit/robe */}
        <path d="M12 56V52L20 48H44L52 52V56" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export const MODEL_ICONS: Record<string, React.ElementType> = {
    elena: IconElena,
    naomi: IconNaomi,
    julian: IconJulian,
    marcus: IconMarcus,
};
