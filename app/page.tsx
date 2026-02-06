'use client';

import { useState } from 'react';
import { ImageUploader } from '@/components/ImageUploader';
import { PromptEditors } from '@/components/PromptEditor';
import { TaskList } from '@/components/TaskList';
import { Clock, ChevronDown, Wand2, ArrowRight, History } from 'lucide-react';
import { Logo } from '@/components/Logo';
import type { CompressedImage } from '@/lib/image-compressor';
import { db } from '@/lib/db';
import Link from 'next/link';

export default function HomePage() {
  const [productImages, setProductImages] = useState<CompressedImage[]>([]);
  const [styleImages, setStyleImages] = useState<CompressedImage[]>([]);
  const [accessoryImages, setAccessoryImages] = useState<CompressedImage[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canGenerate = productImages.length >= 1 && productImages.length <= 3;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);

    try {
      const projectId = await db.projects.add({
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending',
        name: projectName || `丝绸组图 ${new Date().toLocaleString('zh-CN')}`
      });

      for (const img of productImages) {
        await db.images.add({ projectId, type: 'product', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of styleImages) {
        await db.images.add({ projectId, type: 'style', data: img.base64, mimeType: img.mimeType });
      }
      for (const img of accessoryImages) {
        await db.images.add({ projectId, type: 'accessory', data: img.base64, mimeType: img.mimeType });
      }

      window.location.href = `/task/${projectId}`;
    } catch (error) {
      console.error('创建任务失败:', error);
      alert('创建任务失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] pb-24 lg:pb-12">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-18">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center transition-transform hover:scale-105">
                <Logo width={44} height={44} />
              </div>
              <span className="text-lg sm:text-xl font-semibold tracking-tight">
                SILKMOMO
              </span>
            </Link>

            <nav className="hidden sm:flex items-center gap-2">
              <Link
                href="/tasks"
                className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-background)] rounded-xl transition-all"
              >
                <History className="w-4 h-4" />
                历史任务
              </Link>
            </nav>

            <Link
              href="/tasks"
              className="sm:hidden w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--color-background)] transition-colors"
              aria-label="历史任务"
            >
              <Clock className="w-5 h-5 text-[var(--color-text-secondary)]" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero 区域 */}
      <section className="relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-[var(--color-accent)] rounded-full blur-[150px] pointer-events-none" />
          <div className="absolute top-20 right-1/4 w-64 h-64 bg-[var(--color-accent-light)] rounded-full blur-[120px] pointer-events-none" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 lg:pt-20 pb-8 sm:pb-12">
          <div className="max-w-3xl">
            <h1 className="hero-title animate-fade-in-up">
              AI 丝绸服装<br />
              <span className="text-[var(--color-accent)]">组图生成</span>
            </h1>
            <p className="hero-subtitle mt-4 sm:mt-6 max-w-xl animate-fade-in-up animate-fade-in-delay-1">
              上传产品图，AI 自动生成 7 张专业电商图片。
              <br className="hidden sm:block" />
              头图、全身、半身、特写，一键完成。
            </p>
          </div>
        </div>
      </section>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-10">
          {/* 左侧上传区 */}
          <div className="lg:col-span-8 space-y-5 animate-fade-in-up animate-fade-in-delay-2">
            {/* 项目名称 */}
            <div className="bg-[var(--color-surface)] rounded-2xl p-5 sm:p-6 border border-[var(--color-border-light)]">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="项目名称（可选）"
                className="w-full text-base sm:text-lg font-medium placeholder:text-[var(--color-text-muted)] border-0 focus:ring-0 px-0 py-2 bg-transparent"
              />
            </div>

            {/* 上传区域 */}
            <div className="space-y-5">
              {/* 产品图 - 金色边框变体 */}
              <div className="animate-fade-in-up animate-fade-in-delay-2">
                <ImageUploader
                  title="产品图"
                  description="1-3 张丝绸服装产品图（必填）"
                  required
                  maxFiles={3}
                  images={productImages}
                  onImagesChange={setProductImages}
                  variant="gold"
                />
              </div>

              {/* 风格参考 - 灰色边框变体 */}
              <div className="animate-fade-in-up animate-fade-in-delay-3">
                <ImageUploader
                  title="风格参考"
                  description="可选，默认 INS 极简风格"
                  maxFiles={5}
                  images={styleImages}
                  onImagesChange={setStyleImages}
                  variant="gray"
                />
              </div>

              {/* 配件 - 虚线边框变体 */}
              <div className="animate-fade-in-up animate-fade-in-delay-4">
                <ImageUploader
                  title="配件"
                  description="可选，包包、首饰等配饰"
                  maxFiles={5}
                  images={accessoryImages}
                  onImagesChange={setAccessoryImages}
                  variant="dashed"
                />
              </div>
            </div>

            {/* 高级设置 */}
            <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border-light)] overflow-hidden">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-5 sm:px-6 py-4 hover:bg-[var(--color-background)] transition-colors"
              >
                <span className="text-sm font-medium text-[var(--color-text-secondary)]">
                  高级设置
                </span>
                <ChevronDown
                  className={`w-5 h-5 text-[var(--color-text-muted)] transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  strokeWidth={1.5}
                />
              </button>
              {showAdvanced && (
                <div className="px-5 sm:px-6 pb-5 pt-2 border-t border-[var(--color-border-light)]">
                  <PromptEditors onPromptsChange={() => { }} />
                </div>
              )}
            </div>
          </div>

          {/* 右侧边栏 */}
          <div className="hidden lg:block lg:col-span-4 animate-fade-in-up animate-fade-in-delay-3">
            <div className="sticky top-24">
              <div className="sidebar-glass rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  最近任务
                </h3>
                <TaskList />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 移动端固定底部按钮 */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 glass border-t border-[var(--color-border-light)] p-4 sm:p-5">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || isGenerating}
          className="btn-primary w-full"
        >
          {isGenerating ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>生成中...</span>
            </>
          ) : (
            <>
              <Wand2 className="w-5 h-5" strokeWidth={1.5} />
              <span>{canGenerate ? '开始生成 7 张组图' : '请先上传产品图'}</span>
            </>
          )}
        </button>
      </div>

      {/* 桌面端生成按钮 */}
      <div className="hidden lg:block max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || isGenerating}
          className="btn-primary w-full max-w-md mx-auto block"
        >
          {isGenerating ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>生成中...</span>
            </>
          ) : (
            <>
              <Wand2 className="w-5 h-5" strokeWidth={1.5} />
              <span>开始生成 7 张组图</span>
              <ArrowRight className="w-5 h-5" strokeWidth={1.5} />
            </>
          )}
        </button>
      </div>

      {/* 页脚 */}
      <footer className="border-t border-[var(--color-border-light)] py-8 sm:py-10 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-[var(--color-text-muted)]">
            SILKMOMO © 2025 · 奢华丝绸，AI 赋能
          </p>
        </div>
      </footer>
    </div>
  );
}
