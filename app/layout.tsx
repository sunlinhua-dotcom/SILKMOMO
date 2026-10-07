import type { Metadata, Viewport } from "next";
import { Cormorant, Montserrat } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// 字体构建期自托管（原先 globals.css 里阻塞渲染的 Google Fonts @import 已删除）。
// variable 会把字体挂到 html 的 CSS 变量上，globals.css 的 @theme 里 --font-serif / --font-sans 引用它们。
// Cormorant / Montserrat 只含拉丁字形，中文走回退栈 PingFang SC / Microsoft YaHei。
const cormorant = Cormorant({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
  fallback: ["Georgia", "PingFang SC", "Microsoft YaHei", "serif"],
});

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
  fallback: ["PingFang SC", "Microsoft YaHei", "system-ui", "sans-serif"],
});

// viewport-fit=cover：让 env(safe-area-inset-*) 在刘海屏 / 底部手势条上真正生效
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FBF8F4",
};

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
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      className={`${cormorant.variable} ${montserrat.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
