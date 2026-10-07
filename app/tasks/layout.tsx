import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '我的任务 · SILXINE',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
