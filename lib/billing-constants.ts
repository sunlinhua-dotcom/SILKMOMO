/**
 * SILKMOMO 计费常量（客户端安全）
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

// ═══ 充值套餐 ═══
export const RECHARGE_PACKAGES = [
  { id: 'pack_150', name: '起步包', amountFen: 15000, label: '¥150', bonus: 0, description: '约 50 次完整生成' },
  { id: 'pack_300', name: '标准包', amountFen: 30000, label: '¥300', bonus: 0, description: '约 101 次完整生成' },
  { id: 'pack_750', name: '专业包', amountFen: 75000, label: '¥750', bonus: 0, description: '约 254 次完整生成' },
  { id: 'pack_1500', name: '企业包', amountFen: 150000, label: '¥1500', bonus: 0, description: '约 508 次完整生成' },
] as const;
