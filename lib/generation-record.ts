/**
 * Phase 4B：生成记录 + 反馈闭环
 * 记录每次生成的参数和结果，收集用户反馈
 */
import prisma from './prisma';
import { createHash } from 'crypto';

export interface RecordGenerationParams {
  userId: string;
  module: 'product' | 'scene';
  shotIndex?: number;
  promptText: string;
  modelId?: string;
  bodyType?: string;
  skinTone?: string;
  aspectRatio: string;
  apiModel: string;
  success: boolean;
  apiLatencyMs: number;
  errorMessage?: string;
}

/**
 * 记录一次生成
 */
export async function recordGeneration(params: RecordGenerationParams): Promise<string> {
  const promptHash = createHash('md5')
    .update(params.promptText.substring(0, 500))
    .digest('hex');

  const record = await prisma.generationRecord.create({
    data: {
      userId: params.userId,
      module: params.module,
      shotIndex: params.shotIndex,
      promptHash,
      promptText: params.promptText.substring(0, 2000), // 截断过长 prompt
      modelId: params.modelId,
      bodyType: params.bodyType,
      skinTone: params.skinTone,
      aspectRatio: params.aspectRatio,
      apiModel: params.apiModel,
      success: params.success,
      apiLatencyMs: params.apiLatencyMs,
      errorMessage: params.errorMessage,
    },
  });

  return record.id;
}

/**
 * 用户提交反馈
 */
export async function submitFeedback(
  recordId: string,
  userId: string,
  data: {
    rating: -1 | 0 | 1;
    feedback?: string;
    feedbackTags?: string[];
  }
) {
  return await prisma.generationRecord.update({
    where: { id: recordId, userId },
    data: {
      rating: data.rating,
      feedback: data.feedback || '',
      feedbackTags: JSON.stringify(data.feedbackTags || []),
    },
  });
}

/**
 * 标记已下载
 */
export async function markDownloaded(recordId: string, userId: string) {
  return await prisma.generationRecord.update({
    where: { id: recordId, userId },
    data: { downloaded: true },
  });
}

/**
 * 获取 AI 质量分析数据（管理后台用）
 */
export async function getQualityAnalytics() {
  // 1. 总体统计
  const totalGenerations = await prisma.generationRecord.count();
  const successfulGenerations = await prisma.generationRecord.count({
    where: { success: true },
  });
  const ratedGenerations = await prisma.generationRecord.count({
    where: { rating: { not: 0 } },
  });
  const positiveRatings = await prisma.generationRecord.count({
    where: { rating: 1 },
  });
  const negativeRatings = await prisma.generationRecord.count({
    where: { rating: -1 },
  });
  const downloads = await prisma.generationRecord.count({
    where: { downloaded: true },
  });

  // 2. 按镜次统计成功率
  const shotStats = await prisma.generationRecord.groupBy({
    by: ['shotIndex'],
    where: { module: 'product', shotIndex: { not: null } },
    _count: { id: true },
    _avg: { apiLatencyMs: true },
  });

  // 3. 按体型统计
  const bodyTypeStats = await prisma.generationRecord.groupBy({
    by: ['bodyType'],
    where: { bodyType: { not: null } },
    _count: { id: true },
  });

  // 4. 最近的负面反馈（帮助定位问题）
  const recentNegative = await prisma.generationRecord.findMany({
    where: { rating: -1 },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      module: true,
      shotIndex: true,
      modelId: true,
      bodyType: true,
      skinTone: true,
      feedback: true,
      feedbackTags: true,
      createdAt: true,
    },
  });

  // 5. 平均延迟
  const avgLatency = await prisma.generationRecord.aggregate({
    where: { success: true },
    _avg: { apiLatencyMs: true },
  });

  return {
    overview: {
      totalGenerations,
      successRate: totalGenerations > 0
        ? Math.round((successfulGenerations / totalGenerations) * 100)
        : 0,
      satisfactionRate: ratedGenerations > 0
        ? Math.round((positiveRatings / ratedGenerations) * 100)
        : 0,
      positiveRatings,
      negativeRatings,
      unratedCount: totalGenerations - ratedGenerations,
      downloadRate: totalGenerations > 0
        ? Math.round((downloads / totalGenerations) * 100)
        : 0,
      avgLatencyMs: Math.round(avgLatency._avg.apiLatencyMs || 0),
    },
    shotStats: shotStats.map((s: { shotIndex: number | null; _count: { id: number }; _avg: { apiLatencyMs: number | null } }) => ({
      shotIndex: s.shotIndex,
      count: s._count.id,
      avgLatencyMs: Math.round(s._avg.apiLatencyMs || 0),
    })),
    bodyTypeStats: bodyTypeStats.map((s: { bodyType: string | null; _count: { id: number } }) => ({
      bodyType: s.bodyType,
      count: s._count.id,
    })),
    recentNegative: recentNegative.map((r: { id: string; module: string; shotIndex: number | null; modelId: string | null; bodyType: string | null; skinTone: string | null; feedback: string; feedbackTags: string; createdAt: Date }) => ({
      ...r,
      feedbackTags: safeParseJSON(r.feedbackTags, []),
    })),
  };
}

function safeParseJSON<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}
