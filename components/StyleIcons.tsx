import React from 'react';

interface IconProps {
    className?: string;
}

// 1. French Garden (法式庭院) - Archway and Leaf
export const IconFrenchGarden = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M32 56V24C32 15.1634 24.8366 8 16 8H8V56H56V8H48C39.1634 8 32 15.1634 32 24" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 30C32 30 42 22 52 32C62 42 32 56 32 56" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M42 32L32 56" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 2. Lazy Morning (清晨柔光) - Sun rising over pillow
export const IconLazyMorning = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M8 48H56" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 48C16 40 20 34 28 34C36 34 40 40 40 48" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M48 48C48 40 52 34 56 34" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 24V8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M46 26L54 12" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 26L10 12" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="32" cy="32" r="6" />
    </svg>
);

// 3. Hotel Luxury (高奢酒店) - Champagne glass and skyline
export const IconHotelLuxury = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M22 10L22 26C22 32 26 36 32 36C38 36 42 32 42 26V10H22Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 36V54" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M24 54H40" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M48 10L56 54" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 54L16 10" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 20H16" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M48 20H56" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 4. Oriental Zen (东方新中式) - Bamboo and circle
export const IconOrientalZen = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <circle cx="32" cy="32" r="24" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M26 16V48" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38 16V48" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M26 24L18 20" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38 32L46 28" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M26 40L18 36" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 5. Private Spa (私享SPA) - Lotus and water drop
export const IconPrivateSpa = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M32 10C32 10 40 22 40 28C40 32.4183 36.4183 36 32 36C27.5817 36 24 32.4183 24 28C24 22 32 10 32 10Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 40C12 40 22 42 26 48" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M52 40C52 40 42 42 38 48" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 54C8 54 20 50 32 50C44 50 56 54 56 54" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 6. Romantic Night (烛光之夜) - Candle
export const IconRomanticNight = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M24 32H40V56H24V32Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 32V24" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 8C32 8 38 14 38 18C38 21.3137 35.3137 24 32 24C28.6863 24 26 21.3137 26 18C26 14 32 8 32 8Z" fill="currentColor" fillOpacity="0.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 7. Manor Library (庄园书房) - Open Book
export const IconManorLibrary = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M12 16C12 16 20 18 32 16C44 18 52 16 52 16V48C52 48 44 50 32 48C20 50 12 48 12 48V16Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 16V48" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 8. Vacation Villa (度假别墅) - Sun and Wave
export const IconVacationVilla = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <circle cx="48" cy="16" r="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 32C14 28 20 36 26 36C32 36 38 28 44 28C50 28 56 32 56 32" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 44C14 40 20 48 26 48C32 48 38 40 44 40C50 40 56 44 56 44" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 9. Minimalist Home (极简居家) - Vase and branch
export const IconMinimalistHome = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M26 56H38L42 36C42 36 44 24 32 24C20 24 22 36 22 36L26 56Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 24V12" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 12L40 8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 16L24 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

// 10. Bridal Morning (晨袍时刻) - Flower
export const IconBridalMorning = ({ className }: IconProps) => (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M32 32L32 56" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 32C32 32 22 22 18 26C14 30 24 40 32 32Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 32C32 32 42 22 46 26C50 30 40 40 32 32Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 32C32 32 22 42 18 38C14 34 24 24 32 32Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M32 32C32 32 42 42 46 38C50 34 40 24 32 32Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export const STYLE_ICONS: Record<string, React.ElementType> = {
    french_garden: IconFrenchGarden,
    lazy_morning: IconLazyMorning,
    hotel_luxury: IconHotelLuxury,
    oriental_zen: IconOrientalZen,
    private_spa: IconPrivateSpa,
    romantic_night: IconRomanticNight,
    manor_library: IconManorLibrary,
    vacation_villa: IconVacationVilla,
    minimalist_home: IconMinimalistHome,
    bridal_morning: IconBridalMorning,
};
