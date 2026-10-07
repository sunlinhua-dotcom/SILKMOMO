import { TaskList } from '@/components/TaskList';
import { PageHeader } from '@/components/ui/PageHeader';

export default function TasksPage() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="历史生成" backHref="/" />

      {/* 任务列表 */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        <div className="mb-4 sm:mb-6">
          <h2 className="font-serif text-2xl sm:text-4xl text-primary tracking-tight">全部生成任务</h2>
          <p className="text-xs sm:text-sm text-muted mt-1">查看和管理您的所有 AI 生成任务</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 sm:p-6 border border-border-light">
          <TaskList limit={20} />
        </div>
      </main>

      {/* 页脚 — 与主页同步 */}
      <footer className="mt-8 sm:mt-16 mb-6 sm:mb-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="border-t border-border-light pt-6 sm:pt-10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="font-serif text-xs sm:text-sm tracking-widest text-muted">
              SILXINE
            </p>
            <p className="text-[10px] tracking-widest uppercase text-muted">
              © 2026 · Haute Couture, AI-Powered
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
