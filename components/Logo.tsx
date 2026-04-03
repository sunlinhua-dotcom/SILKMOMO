'use client';

import Image from 'next/image';

interface LogoProps {
    className?: string;
    width?: number;
    height?: number;
}

export function Logo({ className = '', width = 40, height = 40 }: LogoProps) {
    return (
        <div className={`relative flex items-center justify-center ${className}`}>
            <Image
                src="/logo.jpeg"
                alt="SILKMOMO"
                width={width}
                height={height}
                className="object-contain rounded-sm"
                priority
            />
        </div>
    );
}
