import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

let source = fs.readFileSync('lib/image-backends.ts', 'utf8');
source = source.replace(
  /import \{ normalizeGenerationQuality, type GenerationQuality \} from '\.\/billing-constants';/,
  "const normalizeGenerationQuality = value => value || 'medium'; type GenerationQuality = 'low' | 'medium' | 'high';",
);
source = source.replace(
  /import \{ normalizeReferenceImage \} from '\.\/reference-image-normalizer';/,
  'const normalizeReferenceImage = async input => input;',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const backends = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

test('buildGeminiParts omits the product label when no product image exists', () => {
  assert.equal(typeof backends.buildGeminiParts, 'function');
  const parts = backends.buildGeminiParts({
    prompt: 'portrait',
    productImages: [],
    aspectRatio: '3:4',
  });
  const text = parts.flatMap(part => typeof part.text === 'string' ? [part.text] : []).join('\n');
  assert.doesNotMatch(text, /Product Reference Images/);
});

test('openai backend falls back to /v1/images/generations when there is no reference image', () => {
  const source = fs.readFileSync('lib/image-backends.ts', 'utf8');

  // edits 端点必须带至少一张输入图；纯文生图（脸库候选脸）走它会被上游判参数错误
  // ——0802 线上实测 403 err_code:-10003。
  assert.match(source, /async function generateWithOpenAIText/);
  assert.match(source, /\/v1\/images\/generations/);
  assert.match(source, /if \(limited\.length === 0\) \{\s*\n\s*return generateWithOpenAIText\(input, retryCount\);/);

  // 与 edits 分支同口径：超时不重试，只有瞬时网络错误/503/429 才重试
  const textBranch = source.slice(source.indexOf('async function generateWithOpenAIText'));
  assert.match(textBranch, /!isTimeout && retryCount < MAX_RETRIES/);
  assert.match(textBranch, /response\.status === 503 \|\| response\.status === 429/);
});
