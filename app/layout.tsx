import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // ⭐ 核心：设置绝对路径的基础 URL
  metadataBase: new URL('https://silkmomo.digirepub.com'),

  title: "SILXINE - AI 电商组图生成",
  description: "利用 AI 为丝绸服装及配饰生成专业的电商产品图片",

  // 浏览器图标(app/icon.svg 由 Next 自动服务于 /icon.svg,任意尺寸清晰)
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/apple-touch-icon.png',
    other: {
      rel: 'apple-touch-icon-precomposed',
      url: '/apple-touch-icon.png',
    },
  },

  // 微信/社交平台分享图
  openGraph: {
    title: 'SILXINE - AI 电商组图生成',
    description: '利用 AI 为丝绸服装及配饰生成专业的电商产品图片',
    images: ['/og-image.jpg'],
    type: 'website',
    siteName: 'SILXINE',
  },

  // iOS 添加到桌面时的配置
  appleWebApp: {
    title: 'SILXINE',
    statusBarStyle: 'black-translucent',
    startupImage: ['/apple-touch-icon.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
