/**
 * SILXINE 计费常量（客户端安全）
 * 不含 Prisma 依赖，可在 client components 中使用
 */

// ═══ 定价配置 ═══
export const PRICING = {
  // ── 生图（gemini-3.1-flash-image-preview）──
  // 每次 API 调用成本（美元）
  costUSD: 0.045,
  // 售价倍率
  markup: 2,
  // 售价（美元）
  sellUSD: 0.09,
  // 人民币汇率（大约）
  exchangeRate: 7.25,
  // 每次 API 调用价格（分）：$0.09 × 7.25 = ¥0.6525 ≈ 65分
  pricePerCallFen: 65,
  // 展示价格（元）
  get pricePerCallYuan() {
    return (this.pricePerCallFen / 100).toFixed(2);
  },

  // ── AI 分析（gemini-3.1-flash-lite-preview）──
  // Flash Lite 成本：~$0.002/次 → 售价 ¥0.35
  aiAnalysisCostUSD: 0.002,
  aiAnalysisPricePerCallFen: 35,
  get aiAnalysisPriceYuan() {
    return (this.aiAnalysisPricePerCallFen / 100).toFixed(2);
  },
} as const;

export type GenerationBackend = 'gemini' | 'openai';
export type GenerationQuality = 'low' | 'medium' | 'high';

export const DEFAULT_GPT_IMAGE_QUALITY: GenerationQuality = 'medium';

export const GPT_IMAGE_QUALITY_OPTIONS: Array<{
  id: GenerationQuality;
  label: string;
  priceFen: number;
  etaSeconds: number;
  etaLabel: string;
}> = [
  { id: 'low', label: '草稿', priceFen: 40, etaSeconds: 35, etaLabel: '约35秒' },
  { id: 'medium', label: '标准', priceFen: 120, etaSeconds: 90, etaLabel: '约90秒' },
  { id: 'high', label: '高清', priceFen: 350, etaSeconds: 150, etaLabel: '约150秒' },
];

export const GPT_IMAGE_PRICES_FEN: Record<GenerationQuality, number> = {
  low: 40,
  medium: 120,
  high: 350,
};

export function normalizeGenerationQuality(quality: unknown): GenerationQuality {
  return quality === 'low' || quality === 'medium' || quality === 'high'
    ? quality
    : DEFAULT_GPT_IMAGE_QUALITY;
}

export function getGenerationQualityLabel(quality: unknown): string {
  const normalized = normalizeGenerationQuality(quality);
  return GPT_IMAGE_QUALITY_OPTIONS.find(option => option.id === normalized)?.label ?? '标准';
}

export function getGenerationQualityEtaSeconds(quality: unknown): number {
  const normalized = normalizeGenerationQuality(quality);
  return GPT_IMAGE_QUALITY_OPTIONS.find(option => option.id === normalized)?.etaSeconds ?? 90;
}

export function getGenerationCostFen(backend: GenerationBackend | string | null | undefined, quality?: unknown): number {
  const normalizedBackend = backend === 'openai' || backend === 'gpt' || backend === 'gpt-image'
    ? 'openai'
    : 'gemini';
  if (normalizedBackend !== 'openai') return PRICING.pricePerCallFen;
  return GPT_IMAGE_PRICES_FEN[normalizeGenerationQuality(quality)];
}

// ═══ 充值套餐 ═══
// 一次"完整生成"按 5 张计；次数从当前单价推导，避免调价后文案虚标
const FULL_GENERATION_FEN = PRICING.pricePerCallFen * 5;
const packDescription = (amountFen: number) =>
  `按 Gemini 约 ${Math.floor(amountFen / FULL_GENERATION_FEN)} 次完整生成`;

export const RECHARGE_PACKAGES = [
  { id: 'pack_150', name: '起步包', amountFen: 15000, label: '¥150', bonus: 0, description: packDescription(15000) },
  { id: 'pack_300', name: '标准包', amountFen: 30000, label: '¥300', bonus: 0, description: packDescription(30000) },
  { id: 'pack_750', name: '专业包', amountFen: 75000, label: '¥750', bonus: 0, description: packDescription(75000) },
  { id: 'pack_1500', name: '企业包', amountFen: 150000, label: '¥1500', bonus: 0, description: packDescription(150000) },
] as const;
