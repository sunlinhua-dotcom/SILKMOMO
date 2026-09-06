/**
 * [G] 提示词快照
 *
 * 四个 builder 的输出是产品的核心资产：改一个字都会改变出图。这里用固定输入矩阵把
 * 它们的返回值逐字节钉死，任何无意的改动（重构、格式化、误删一行约束）都会红。
 *
 * 有意改提示词时：
 *   UPDATE_PROMPT_SNAPSHOT=1 npm run test:prompts
 * 重写 fixture，并在 commit message 里说明改的是哪一条规则、为什么。
 * 不写理由就重写 fixture，等于把这层保护关掉。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const api = await import('../lib/api.ts');
const models = await import('../lib/models.ts');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'prompt-snapshot.json');

// ── 固定输入素材（内容不参与提示词文本，只影响"有没有"的分支） ──
const img = (tag) => ({ data: `fixture-${tag}`, mimeType: 'image/jpeg' });
const SHOT_FULL_BODY = models.PRODUCT_SHOTS[0];                              // hasModel: true
const SHOT_DETAIL = models.PRODUCT_SHOTS[3];
const SHOT_FLAT_LAY = models.PRODUCT_SHOTS.find(s => !s.hasModel);           // hasModel: false
const MODEL_A = models.MODELS[0];
const MODEL_B = models.MODELS[2];
const SILK_DESC = 'ivory silk charmeuse slip dress with bias-cut skirt and cowl neckline';
const COTTON_DESC = 'sand cotton-poplin oversized shirt with dropped shoulders and horn buttons';

// ── 输入矩阵：每个可选参数都要在某条 case 里被翻过 ──
const CASES = {
  // [B] 产品图：无模特配置 / 全参数 / 换模特换镜次 / 平铺（hasModel=false）
  'product/minimal': () => api.buildProductShotPrompt({
    shot: SHOT_FULL_BODY,
    productImages: [img('product-1')],
  }),
  'product/full-model-a': () => api.buildProductShotPrompt({
    shot: SHOT_FULL_BODY,
    productImages: [img('product-1'), img('product-2')],
    modelConfig: MODEL_A,
    bodyTypeConfig: models.BODY_TYPES[0],
    skinToneConfig: models.SKIN_TONES[0],
    modelRefImages: [img('model-ref')],
    bgRefImages: [img('bg-ref')],
    accessoryImages: [img('accessory')],
    outputSize: models.PRODUCT_OUTPUT_SIZES[0],
    garmentDescription: SILK_DESC,
    customPrompt: '把袖口再收紧一点',
  }),
  'product/full-model-b-cotton': () => api.buildProductShotPrompt({
    shot: SHOT_DETAIL,
    productImages: [img('product-1')],
    modelConfig: MODEL_B,
    bodyTypeConfig: models.BODY_TYPES[2],
    skinToneConfig: models.SKIN_TONES[2],
    outputSize: models.PRODUCT_OUTPUT_SIZES[2],
    garmentDescription: COTTON_DESC,
  }),
  'product/flat-lay-no-model': () => api.buildProductShotPrompt({
    shot: SHOT_FLAT_LAY,
    productImages: [img('product-1')],
    bodyTypeConfig: models.BODY_TYPES[1],
    skinToneConfig: models.SKIN_TONES[1],
    outputSize: models.PRODUCT_OUTPUT_SIZES[4],
    garmentDescription: SILK_DESC,
    customPrompt: '背景换成米白亚麻',
  }),

  // [B] 场景图：有模特 / 无模特 / 换模特与构图参数
  'scene/minimal': () => api.buildSceneShotPrompt({
    productImages: [img('product-1')],
    sceneRefImages: [img('scene-ref')],
  }),
  'scene/full-model-a': () => api.buildSceneShotPrompt({
    productImages: [img('product-1')],
    sceneRefImages: [img('scene-ref-1'), img('scene-ref-2')],
    modelConfig: MODEL_A,
    bodyTypeConfig: models.BODY_TYPES[0],
    skinToneConfig: models.SKIN_TONES[0],
    modelRefImages: [img('model-ref')],
    accessoryImages: [img('accessory')],
    outputSize: models.SCENE_OUTPUT_SIZES[0],
    frameType: 'full_body',
    angle: 'front',
    hasModel: true,
    garmentDescription: SILK_DESC,
    customPrompt: '光线再暖一点',
  }),
  'scene/model-b-upper-side': () => api.buildSceneShotPrompt({
    productImages: [img('product-1')],
    sceneRefImages: [img('scene-ref')],
    modelConfig: MODEL_B,
    bodyTypeConfig: models.BODY_TYPES[2],
    skinToneConfig: models.SKIN_TONES[2],
    outputSize: models.SCENE_OUTPUT_SIZES[2],
    frameType: 'upper_body',
    angle: 'side',
    hasModel: true,
    garmentDescription: COTTON_DESC,
  }),
  'scene/no-model': () => api.buildSceneShotPrompt({
    productImages: [img('product-1')],
    sceneRefImages: [img('scene-ref')],
    outputSize: models.SCENE_OUTPUT_SIZES[1],
    frameType: 'close_up',
    angle: 'back',
    hasModel: false,
    garmentDescription: SILK_DESC,
    customPrompt: '不要出现人',
  }),

  // [C]/[D] 组图换装：fresh / follow_scene × 有锚 / 无锚，products 多品，重做
  'group/minimal': () => api.buildSceneGroupPrompt({}),
  'group/swap-fresh-no-anchor': () => api.buildSceneGroupPrompt({
    garmentDescription: SILK_DESC,
    garmentCategories: ['dress'],
    sceneGroupMode: 'swap',
    modelIdentityMode: 'fresh',
    hasAnchor: false,
  }),
  'group/swap-fresh-with-anchor': () => api.buildSceneGroupPrompt({
    garmentDescription: SILK_DESC,
    garmentCategories: ['dress'],
    sceneGroupMode: 'swap',
    modelIdentityMode: 'fresh',
    hasAnchor: true,
    hasReplacementAccessory: true,
  }),
  'group/swap-follow-scene-with-anchor': () => api.buildSceneGroupPrompt({
    garmentDescription: SILK_DESC,
    garmentCategories: ['top'],
    sceneGroupMode: 'swap',
    modelIdentityMode: 'follow_scene',
    hasAnchor: true,
  }),
  'group/swap-follow-scene-no-anchor': () => api.buildSceneGroupPrompt({
    garmentDescription: SILK_DESC,
    garmentCategories: ['top'],
    sceneGroupMode: 'swap',
    modelIdentityMode: 'follow_scene',
    hasAnchor: false,
  }),
  'group/products-multi-garment': () => api.buildSceneGroupPrompt({
    garmentDescription: COTTON_DESC,
    garmentCategories: ['top', 'pants', 'outerwear'],
    sceneGroupMode: 'products',
    modelIdentityMode: 'fresh',
    productLabel: '春夏第 2 组',
    hasAnchor: true,
    hasReplacementAccessory: true,
    customPrompt: '外套敞开穿',
  }),
  'group/regeneration': () => api.buildSceneGroupPrompt({
    garmentDescription: SILK_DESC,
    garmentCategories: ['dress', 'skirt'],
    sceneGroupMode: 'products',
    modelIdentityMode: 'follow_scene',
    productLabel: '补齐第 5 张',
    hasAnchor: true,
    hasReplacementAccessory: false,
    isRegeneration: true,
    customPrompt: '和前四张保持同一间屋子',
  }),

  // [D] 派生身份锚：两个可选参数的四种组合
  'anchor/no-args': () => api.buildDerivedAnchorPortraitPrompt(),
  'anchor/skin-only': () => api.buildDerivedAnchorPortraitPrompt('warm medium-tan complexion, olive undertone'),
  'anchor/variation-only': () => api.buildDerivedAnchorPortraitPrompt(undefined, 'slightly rounder jawline'),
  'anchor/skin-and-variation': () => api.buildDerivedAnchorPortraitPrompt(
    'warm medium-tan complexion, olive undertone',
    'slightly rounder jawline',
  ),
};

// [D] 脸库十张脸的肖像提示词：MODEL_FACE_SPECS 与 builder 一起搬家时也要逐字节不变
// ModelFaceSpec 没有 id 字段，按「顺序 + 族裔」做 key：顺序就是脸库展示顺序，动了顺序也要红。
api.MODEL_FACE_SPECS.forEach((spec, i) => {
  CASES[`model-face/${String(i + 1).padStart(2, '0')}-${spec.ethnicity}`] =
    () => api.buildModelFacePortraitPrompt(spec);
});

const actual = Object.fromEntries(Object.entries(CASES).map(([name, fn]) => [name, fn()]));

if (process.env.UPDATE_PROMPT_SNAPSHOT === '1') {
  fs.writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
  console.log(`[prompt-snapshot] fixture rewritten: ${Object.keys(actual).length} cases`);
}

const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('快照用例集合没有增删（新增用例要连 fixture 一起提交）', () => {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
});

for (const name of Object.keys(CASES)) {
  test(`提示词逐字节不变: ${name}`, () => {
    assert.equal(
      actual[name],
      expected[name],
      `${name} 的提示词变了。若是有意改动，用 UPDATE_PROMPT_SNAPSHOT=1 npm run test:prompts 重写 fixture，并在 commit message 里写清改了哪条规则。`,
    );
  });
}

test('快照不是空壳：每条用例都有实质内容', () => {
  for (const [name, prompt] of Object.entries(actual)) {
    assert.equal(typeof prompt, 'string', `${name} 不是字符串`);
    assert.ok(prompt.trim().length > 200, `${name} 只有 ${prompt.length} 字符，疑似 builder 退化`);
  }
});
