import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '品牌档案 · SILXINE',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
