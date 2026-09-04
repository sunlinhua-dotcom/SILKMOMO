import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SCENE_PATH = path.join(REPO_ROOT, 'verify-0904-锚图AB', 'reference_scene.jpeg');
const PRODUCT_PATH = path.join(REPO_ROOT, 'verify-0717-出图验证', '产品参考-正面.jpeg');
const ANCHOR_PATH = path.join(HERE, 'derived-anchor.png');
const LOOK_PATH = path.join(HERE, 'follow-scene-look.png');
const CONTACT_PATH = path.join(HERE, 'contact.jpg');
const RESULTS_PATH = path.join(HERE, 'results.json');

loadEnv({ path: path.join(REPO_ROOT, '.env'), quiet: true });
loadEnv({ path: path.join(REPO_ROOT, '.env.local'), override: true, quiet: true });

if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');
if (!process.env.OPENAI_IMAGE_API_KEY) throw new Error('OPENAI_IMAGE_API_KEY is missing');

// 与 09-04 提示词优化验证保持相同的两个上游与模型。
process.env.DERIVED_ANCHOR_MODEL = 'gemini-3-pro-image';
process.env.OPENAI_IMAGE_MODEL = 'gpt-image-2';
process.env.OPENAI_IMAGE_BASE_URL = 'https://api.302.ai';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { buildDerivedAnchorPortraitPrompt, buildSceneGroupPrompt } = require('../lib/api.ts');
const { generateImage } = require('../lib/image-backends.ts');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const secretValues = [process.env.GEMINI_API_KEY, process.env.OPENAI_IMAGE_API_KEY].filter(Boolean);
const sanitize = (value) => {
  let result = String(value || 'unknown error');
  for (const secret of secretValues) result = result.split(secret).join('***');
  return result.slice(0, 800);
};

async function imageInput(filePath) {
  const buffer = await fsp.readFile(filePath);
  const metadata = await sharp(buffer).metadata();
  const mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format || 'png'}`;
  return {
    input: { data: buffer.toString('base64'), mimeType },
    metadata: {
      file: path.relative(REPO_ROOT, filePath),
      mimeType,
      width: metadata.width,
      height: metadata.height,
      bytes: buffer.length,
      sha256: sha256(buffer),
    },
  };
}

async function savePng(base64, filePath) {
  const output = await sharp(Buffer.from(base64, 'base64'))
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  await fsp.writeFile(filePath, output.data);
  return {
    file: path.basename(filePath),
    width: output.info.width,
    height: output.info.height,
    bytes: output.data.length,
    sha256: sha256(output.data),
  };
}

function labelSvg(label) {
  const escaped = label.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
  return Buffer.from(
    '<svg width="512" height="52" xmlns="http://www.w3.org/2000/svg">' +
    '<rect width="100%" height="100%" fill="#f4f1eb"/>' +
    `<text x="18" y="34" font-family="Arial, sans-serif" font-size="22" fill="#171717">${escaped}</text>` +
    '</svg>',
  );
}

async function contactPanel(filePath, label) {
  return sharp(filePath)
    .rotate()
    .resize({ width: 512, height: 650, fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .extend({ top: 52, bottom: 0, left: 0, right: 0, background: '#f4f1eb' })
    .composite([{ input: labelSvg(label), left: 0, top: 0 }])
    .jpeg({ quality: 86, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function buildContact() {
  const panels = await Promise.all([
    contactPanel(SCENE_PATH, 'scene reference'),
    contactPanel(ANCHOR_PATH, 'derived anchor · rollback prompt'),
    contactPanel(LOOK_PATH, 'follow_scene · rollback prompt'),
  ]);
  const result = await sharp({
    create: { width: 1536, height: 702, channels: 3, background: '#ffffff' },
  })
    .composite(panels.map((input, index) => ({ input, left: index * 512, top: 0 })))
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toFile(CONTACT_PATH);
  return {
    file: path.basename(CONTACT_PATH),
    width: result.width,
    height: result.height,
    bytes: result.size,
  };
}

const scene = await imageInput(SCENE_PATH);
const product = await imageInput(PRODUCT_PATH);
const startedAt = now();
const totalStarted = performance.now();
const results = {
  experiment: '09-04 follow_scene rollback verification',
  instruction: 'Measure tone continuity only; do not score or judge identity similarity.',
  sourceCommit: 'd72b759cd590ba5bc676e851e9654b6f5511b3c5',
  startedAt,
  completedAt: null,
  serialGenerationCalls: 2,
  references: { scene: scene.metadata, product: product.metadata },
  anchor: null,
  composition: null,
  contactSheet: null,
  totalDurationMs: null,
};

try {
  const anchorPrompt = buildDerivedAnchorPortraitPrompt();
  const anchorStarted = performance.now();
  console.log('[1/2] deriving the same-person identity anchor with Gemini Pro');
  const anchorResult = await generateImage({
    prompt: anchorPrompt,
    productImages: [],
    sceneRefImages: [scene.input],
    aspectRatio: '3:4',
    promptPurpose: 'derived-anchor',
  }, 'gemini');
  const anchorDurationMs = Math.round(performance.now() - anchorStarted);
  if (!anchorResult.success || !anchorResult.data) {
    throw new Error(`anchor generation failed: ${sanitize(anchorResult.error)}`);
  }
  const anchorOutput = await savePng(anchorResult.data, ANCHOR_PATH);
  results.anchor = {
    success: true,
    provider: 'apiyi',
    backend: anchorResult.backend,
    model: anchorResult.model,
    aspectRatio: '3:4',
    imageSize: '2K',
    durationMs: anchorDurationMs,
    promptChars: anchorPrompt.length,
    promptSha256: sha256(anchorPrompt),
    output: anchorOutput,
  };
  console.log(`[1/2] complete in ${anchorDurationMs} ms (${anchorResult.model})`);

  const garmentDescription = 'blush-pink satin pajama top with a square neckline, flutter short sleeves, gathered front yoke, and self-covered center-front buttons';
  const composePrompt = buildSceneGroupPrompt({
    garmentDescription,
    garmentCategories: ['top'],
    modelIdentityMode: 'follow_scene',
    hasAnchor: true,
  });
  const composeStarted = performance.now();
  console.log('[2/2] composing the follow_scene look with GPT Image 2');
  const composeResult = await generateImage({
    prompt: composePrompt,
    productImages: [product.input],
    sceneRefImages: [scene.input],
    anchorImage: { data: anchorResult.data, mimeType: 'image/png' },
    aspectRatio: '3:4',
    quality: 'medium',
    sceneAsEditBase: true,
    promptPurpose: 'compose',
    allowRetryOn5xx: false,
  }, 'openai');
  const composeDurationMs = Math.round(performance.now() - composeStarted);
  if (!composeResult.success || !composeResult.data) {
    throw new Error(`composition failed: ${sanitize(composeResult.error)}`);
  }
  const composeOutput = await savePng(composeResult.data, LOOK_PATH);
  results.composition = {
    success: true,
    provider: '302.ai',
    backend: composeResult.backend,
    model: composeResult.model,
    quality: 'medium',
    aspectRatio: '3:4',
    durationMs: composeDurationMs,
    promptChars: composePrompt.length,
    promptSha256: sha256(composePrompt),
    garmentDescription,
    output: composeOutput,
  };
  console.log(`[2/2] complete in ${composeDurationMs} ms (${composeResult.model})`);

  results.contactSheet = await buildContact();
  results.completedAt = now();
  results.totalDurationMs = Math.round(performance.now() - totalStarted);
  await fsp.writeFile(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`verification complete in ${results.totalDurationMs} ms`);
} catch (error) {
  results.completedAt = now();
  results.totalDurationMs = Math.round(performance.now() - totalStarted);
  results.error = sanitize(error instanceof Error ? error.message : error);
  await fsp.writeFile(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  throw new Error(results.error);
}
