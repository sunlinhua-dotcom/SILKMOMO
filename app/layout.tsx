import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SILKMOMO - AI 电商组图生成",
  description: "利用 AI 为丝绸服装及配饰生成专业的电商产品图片",
  icons: {
    icon: '/logo.svg',
    shortcut: '/logo.svg',
    apple: '/logo.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
