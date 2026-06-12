'use client';

interface LogoProps {
    className?: string;
    width?: number;
    height?: number;
}

/**
 * SILXINE 品牌标识 — 丝绸缎带勾出的书法 "S"
 * 内联 SVG:任意尺寸清晰、无需加载图片资源。
 * 配色取自 silxine.com 官网(墨 #2C2825 / 米白 #F5EFE7)与本应用金棕主题。
 */
export function Logo({ className = '', width = 40, height = 40 }: LogoProps) {
    return (
        <div className={`relative flex items-center justify-center ${className}`}>
            <svg
                width={width}
                height={height}
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                role="img"
                aria-label="SILXINE"
            >
                <defs>
                    <linearGradient id="silx-gold" x1="20" y1="10" x2="46" y2="54" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stopColor="#DCC298" />
                        <stop offset="0.5" stopColor="#C9A86C" />
                        <stop offset="1" stopColor="#8B6F47" />
                    </linearGradient>
                </defs>
                {/* 投影层:墨色微偏移,营造丝绸褶皱的厚度 */}
                <path
                    d="M45.5 16.5 C41 10, 25 8.5, 20 15.5 C15 22.5, 22 27.5, 31 31 C40 34.5, 48 38.5, 44.5 47 C41 55.5, 24.5 56.5, 18.5 50"
                    stroke="#2C2825"
                    strokeOpacity="0.22"
                    strokeWidth="7"
                    strokeLinecap="round"
                    transform="translate(1.4 1.6)"
                />
                {/* 主体:金色缎带 S */}
                <path
                    d="M45.5 16.5 C41 10, 25 8.5, 20 15.5 C15 22.5, 22 27.5, 31 31 C40 34.5, 48 38.5, 44.5 47 C41 55.5, 24.5 56.5, 18.5 50"
                    stroke="url(#silx-gold)"
                    strokeWidth="7"
                    strokeLinecap="round"
                />
                {/* 高光:缎面光泽 */}
                <path
                    d="M45.5 16.5 C41 10, 25 8.5, 20 15.5 C15 22.5, 22 27.5, 31 31 C40 34.5, 48 38.5, 44.5 47 C41 55.5, 24.5 56.5, 18.5 50"
                    stroke="#FBF5EA"
                    strokeOpacity="0.55"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    transform="translate(-1 -1.2)"
                />
            </svg>
        </div>
    );
}
