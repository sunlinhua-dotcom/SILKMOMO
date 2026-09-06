/**
 * SILXINE API 封装 - Phase 2
 * 产品图模块 + 场景图模块分离的 Prompt 架构
 */

// 旧版 generateProductShots / generateSceneShots / generateSevenImages 已删除。
// 所有生图调用都已迁移到 POST /api/generate/stream（SSE 流式接口，避免 Server Action
// 路径上"扣费成功但不退款"的资金安全 bug）。

// ===== 0906 板块拆分：本文件只剩 re-export 桶 =====
// 提示词构造器已按板块搬到 lib/prompts/*，内容一个字没改；这里保留原样的导出名，
// 让所有 `from '@/lib/api'` 的 import 一行都不用动。
//
// 改提示词请直接去下面对应的文件，别再往这个桶里写实现：
//   lib/prompts/shared.ts       接口类型 / 等待文案 / 三个构造器共用的指令片段
//   lib/prompts/product.ts      [A] 产品图
//   lib/prompts/scene.ts        [B] 场景图
//   lib/prompts/group.ts        [C] 组图·换装
//   lib/prompts/face-anchor.ts  [D] 身份锚与模特脸库

export type { GenerateOptions, GenerateResult } from './prompts/shared.ts';
export { WAITING_MESSAGES, getRandomWaitingMessage, FACE_REALISM_DIRECTIVE } from './prompts/shared.ts';

export type { ShotGenerateOptions } from './prompts/product.ts';
export { buildProductShotPrompt } from './prompts/product.ts';

export type { SceneGenerateOptions } from './prompts/scene.ts';
export { buildSceneShotPrompt } from './prompts/scene.ts';

export type { ModelIdentityMode, SceneGroupGenerateOptions } from './prompts/group.ts';
export { buildSceneGroupPrompt } from './prompts/group.ts';

export type { ModelFaceEthnicity, ModelFaceSpec } from './prompts/face-anchor.ts';
export {
  buildDerivedAnchorPortraitPrompt,
  buildModelFacePortraitPrompt,
  MODEL_FACE_SPECS,
} from './prompts/face-anchor.ts';
