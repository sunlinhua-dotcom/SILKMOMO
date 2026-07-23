import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = await import('../lib/api.ts');

test('buildSceneGroupPrompt garment-only pass preserves person and omits anchor face replacement', () => {
  const prompt = api.buildSceneGroupPrompt({
    garmentDescription: 'ivory silk blouse with pearl buttons',
    garmentCategories: ['top'],
    modelIdentityMode: 'follow_scene',
    hasAnchor: true,
    identityPass: 'garment-only',
  });

  assert.match(prompt, /only replace garment/i);
  assert.match(prompt, /face\/hair\/skin tone\/body build/i);
  assert.doesNotMatch(prompt, /anchor face shape/i);
  assert.doesNotMatch(prompt, /REPLACE #2 - Person: Replace the person/i);
});

test('buildSceneGroupPrompt garment-only pass locks newly exposed skin to scene tone', () => {
  const prompt = api.buildSceneGroupPrompt({
    garmentDescription: 'short-sleeve ivory silk blouse',
    garmentCategories: ['top'],
    modelIdentityMode: 'follow_scene',
    identityPass: 'garment-only',
    sceneSkinTone: 'deep honey bronze tan with warm golden olive undertone',
  });

  assert.match(prompt, /skin EVERYWHERE/i);
  assert.match(prompt, /newly exposed by the garment change/i);
  assert.match(prompt, /deep honey bronze tan with warm golden olive undertone/);
  assert.match(prompt, /paler or pinker newly-exposed skin is a FAILURE/i);
});

test('buildFaceSwapPrompt limits edits to visible face and preserves scene skin and occluders', () => {
  assert.equal(typeof api.buildFaceSwapPrompt, 'function');
  const prompt = api.buildFaceSwapPrompt('deep warm olive tan with golden undertone');

  assert.match(prompt, /only in the editable area/i);
  assert.match(prompt, /face shape/i);
  assert.match(prompt, /neck\/body/i);
  assert.match(prompt, /do not change hair strands/i);
  assert.match(prompt, /outside the editable area/i);
  assert.match(prompt, /deep warm olive tan/i);
});

test('follow_scene two-pass activates per image only when a derived anchor exists', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  assert.match(routeSource, /const twoPassActive = useFollowSceneTwoPass && !!anchorImage/);
  assert.match(routeSource, /identityPass: twoPassActive \? 'garment-only' : 'combined'/);
  assert.match(routeSource, /hasAnchor: !twoPassActive && shouldUseSceneGroupAnchor && !!anchorImage/);
  assert.match(routeSource, /if \(useFollowSceneTwoPass && !twoPassActive\)/);
  assert.match(routeSource, /派生锚缺失，回退单步换脸/);
  assert.doesNotMatch(routeSource, /if \(useFollowSceneTwoPass && pass1Result\.success && pass1Result\.data\)/);
});
