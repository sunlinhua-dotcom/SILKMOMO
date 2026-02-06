'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, type Project, type ImageItem } from '@/lib/db';
import { ResultGallery } from '@/components/ResultGallery';
import { Clock, CheckCircle, XCircle, Loader, Wand2 } from 'lucide-react';
import { Logo } from '@/components/Logo';
import Link from 'next/link';
import { generateSevenImages, getRandomWaitingMessage } from '@/lib/api';

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [inputImages, setInputImages] = useState<{
    products: ImageItem[];
    styles: ImageItem[];
    accessories: ImageItem[];
  }>({ products: [], styles: [], accessories: [] });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 7 });
  const [waitingMessage, setWaitingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTaskData = useCallback(async () => {
    try {
      const task = await db.projects.get(taskId);
      if (!task) {
        router.push('/');
        return;
      }
      const allImages = await db.images.where('projectId').equals(taskId).toArray();

      setProject(task);
      setImages(allImages.filter(img => img.type === 'result'));
      setInputImages({
        products: allImages.filter(img => img.type === 'product'),
        styles: allImages.filter(img => img.type === 'style'),
        accessories: allImages.filter(img => img.type === 'accessory')
      });
    } catch (error) {
      console.error('加载任务失败:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId, router]);

  useEffect(() => {
    loadTaskData();
    const interval = setInterval(() => setWaitingMessage(getRandomWaitingMessage()), 4000);
    return () => clearInterval(interval);
  }, [loadTaskData]);



  const handleStartGeneration = async () => {
    if (!project || inputImages.products.length === 0) return;

    setGenerating(true);
    setProgress({ current: 0, total: 7 });

    try {
      await db.projects.update(taskId, { status: 'processing' });
      setProject(prev => prev ? { ...prev, status: 'processing' } : null);

      const productImages = inputImages.products.map(img => ({ data: img.data, mimeType: img.mimeType }));
      const styleImages = inputImages.styles.map(img => ({ data: img.data, mimeType: img.mimeType }));
      const accessoryImages = inputImages.accessories.map(img => ({ data: img.data, mimeType: img.mimeType }));

      const results = await generateSevenImages(
        productImages,
        styleImages.length > 0 ? styleImages : undefined,
        accessoryImages.length > 0 ? accessoryImages : undefined,
        undefined,
        (current, total) => setProgress({ current, total })
      );

      let successCount = 0;
      for (const result of results) {
        if (result.data && !result.error) {
          let imageType: 'hero' | 'full_body' | 'half_body' | 'close_up' = 'close_up';
          let index = 1;
          if (result.type === 'hero') imageType = 'hero';
          else if (result.type.startsWith('full_body')) { imageType = 'full_body'; index = parseInt(result.type.split('_')[2]); }
          else if (result.type.startsWith('half_body')) { imageType = 'half_body'; index = parseInt(result.type.split('_')[2]); }
          else if (result.type.startsWith('close_up')) { imageType = 'close_up'; index = parseInt(result.type.split('_')[2]); }

          await db.images.add({
            projectId: taskId,
            type: 'result',
            data: result.data,
            mimeType: 'image/png',
            imageType,
            index
          });
          successCount++;
        }
      }

      const finalStatus = successCount > 0 ? 'completed' : 'failed';
      await db.projects.update(taskId, { status: finalStatus, updatedAt: new Date() });
      await loadTaskData();

    } catch (error) {
      console.error('生成失败:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      setErrorMessage(errorMsg);
      await db.projects.update(taskId, { status: 'failed', updatedAt: new Date() });
      setProject(prev => prev ? { ...prev, status: 'failed' } : null);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async (imageId: number) => {
    console.log('重新生成图片:', imageId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-light)] flex items-center justify-center mx-auto mb-4">
            <Loader className="w-6 h-6 text-[var(--color-accent)] animate-spin" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">加载中...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center">
        <p className="text-[var(--color-text-muted)]">任务不存在</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 glass border-b border-[var(--color-border-light)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 flex items-center justify-center transition-transform hover:scale-105">
                <Logo width={40} height={40} />
              </div>
              <span className="text-lg font-semibold tracking-tight">SILKMOMO</span>
            </Link>

            <div className="flex items-center gap-4">
              <h1 className="text-base sm:text-lg font-medium truncate max-w-[200px] text-[var(--color-text)]">
                {project.name}
              </h1>
              {/* 状态指示 */}
              {project.status === 'pending' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-background)] rounded-full">
                  <Clock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                  等待生成
                </span>
              )}
              {project.status === 'processing' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[var(--color-accent)]/10 rounded-full text-[var(--color-accent)]">
                  <Loader className="w-3.5 h-3.5 animate-spin" />
                  {progress.current}/{progress.total}
                </span>
              )}
              {project.status === 'completed' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-green-50 rounded-full text-green-600">
                  <CheckCircle className="w-3.5 h-3.5" />
                  已完成
                </span>
              )}
              {project.status === 'failed' && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-red-50 rounded-full text-red-500">
                  <XCircle className="w-3.5 h-3.5" />
                  失败
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* 生成中状态 */}
        {generating && (
          <div className="mb-12 text-center py-16 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-light)] flex items-center justify-center shadow-lg">
              <Wand2 className="w-10 h-10 text-white animate-pulse" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-semibold mb-3">正在生成您的组图</h2>
            <p className="text-[var(--color-text-secondary)] mb-8 max-w-md mx-auto">{waitingMessage}</p>
            <div className="max-w-sm mx-auto">
              <div className="h-2 bg-[var(--color-background)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-light)] transition-all duration-500 rounded-full"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mt-3">
                正在生成第 {progress.current} 张，共 {progress.total} 张
              </p>
            </div>
          </div>
        )}

        {/* 输入图片 */}
        <div className="mb-10 bg-[var(--color-surface)] rounded-2xl p-5 border border-[var(--color-border-light)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            输入图片
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {inputImages.products.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-[var(--color-accent)] shadow-sm">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="产品"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ))}
            {inputImages.styles.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-[var(--color-border)] opacity-80">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="风格"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ))}
            {inputImages.accessories.map(img => (
              <div key={img.id} className="flex-shrink-0">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-dashed border-[var(--color-border)] opacity-60">
                  <img
                    src={`data:${img.mimeType};base64,${img.data}`}
                    alt="配件"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 开始生成按钮 */}
        {project.status === 'pending' && !generating && (
          <div className="mb-12 text-center py-12 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#1a1a1a] flex items-center justify-center">
              <Wand2 className="w-8 h-8 text-[var(--color-accent)]" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl font-semibold mb-3">准备生成您的组图</h2>
            <p className="text-[var(--color-text-secondary)] mb-8 text-sm max-w-md mx-auto">
              AI 将为您生成 7 张专业电商图片，包括头图、全身照、半身照和特写
            </p>
            <button
              onClick={handleStartGeneration}
              className="btn-primary"
            >
              <Wand2 className="w-5 h-5" strokeWidth={1.5} />
              开始生成 7 张组图
            </button>
            <p className="text-xs text-[var(--color-text-muted)] mt-4">
              预计需要 3-5 分钟，请保持页面开启
            </p>
          </div>
        )}

        {/* 结果展示 */}
        {images.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-6 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              生成结果
            </h2>
            <ResultGallery
              images={images.map(img => ({
                id: img.id!,
                type: img.imageType || 'close_up',
                imageType: img.imageType || 'close_up',
                data: img.data,
                prompt: img.prompt,
                index: img.index
              }))}
              onRegenerate={handleRegenerate}
            />
          </div>
        )}

        {/* 失败状态 */}
        {project.status === 'failed' && images.length === 0 && (
          <div className="text-center py-20 bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border-light)]">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
              <XCircle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">生成失败</h2>
            <p className="text-[var(--color-text-secondary)] mb-4 text-sm max-w-md mx-auto">
              请检查网络连接或稍后重试
            </p>
            {errorMessage && (
              <div className="max-w-md mx-auto mb-8 p-4 bg-[var(--color-background)] rounded-xl">
                <p className="text-xs text-[var(--color-text-muted)] font-mono break-all">
                  {errorMessage}
                </p>
              </div>
            )}
            <button
              onClick={handleStartGeneration}
              className="btn-primary"
            >
              重试
            </button>
          </div>
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-[var(--color-border-light)] py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-[var(--color-text-muted)]">
            SILKMOMO © 2025 · 奢华丝绸，AI 赋能
          </p>
        </div>
      </footer>
    </div>
  );
}
