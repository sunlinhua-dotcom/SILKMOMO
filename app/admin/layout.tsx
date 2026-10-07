import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '管理后台 · SILXINE',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
