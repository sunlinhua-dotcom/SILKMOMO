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
