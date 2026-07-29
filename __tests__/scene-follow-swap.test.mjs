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
  assert.match(prompt, /Person freeze/i);
  assert.match(prompt, /face, hair, skin tone, body build/i);
  assert.doesNotMatch(prompt, /FACE, SKIN & LIGHT REALISM/i);
  assert.doesNotMatch(prompt, /tiny blemishes/i);
  assert.doesNotMatch(prompt, /anchor face shape/i);
  assert.doesNotMatch(prompt, /REPLACE #2 - Person: Replace the person/i);
  assert.doesNotMatch(prompt, /facial identity/i);
  assert.doesNotMatch(prompt, /the person's identity change/i);
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

  assert.match(prompt, /inside the mask/i);
  assert.match(prompt, /face shape/i);
  assert.match(prompt, /neck and shoulders/i);
  assert.match(prompt, /hair, hairline, eyewear/i);
  assert.match(prompt, /Outside it every pixel is final/i);
  assert.match(prompt, /deep warm olive tan/i);
  assert.match(prompt, /visible pores/i);
  assert.match(prompt, /sees a different woman/i);
});

test('buildFaceSwapPrompt adds lower-face identity rules for eyewear occlusion', () => {
  const prompt = api.buildFaceSwapPrompt(undefined, {
    lowerFaceOnly: true,
    occluders: ['sunglasses'],
  });

  assert.match(prompt, /identity reads entirely from the lower face/);
  assert.match(prompt, /anchor's lip outline and cupid's bow/);
  assert.match(prompt, /mouth width/);
  assert.match(prompt, /philtrum length/);
  assert.match(prompt, /chin point/);
  assert.match(prompt, /jaw angle/);
  assert.match(prompt, /lower-cheek contour/);
  assert.match(prompt, /Reproducing the previous person's lips, mouth width, jawline or chin is a failure/);
});

test('derived follow-scene anchor uses the final head-and-shoulders identity portrait prompt', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const derivedStart = routeSource.indexOf('function buildDerivedAnchorPortraitPrompt');
  const derivedEnd = routeSource.indexOf('// ═════════════════', derivedStart);
  const derivedBlock = routeSource.slice(derivedStart, derivedEnd);

  assert.ok(derivedStart > -1);
  assert.match(derivedBlock, /Head and shoulders/);
  assert.match(derivedBlock, /85mm lens/);
  assert.match(derivedBlock, /face filling roughly 40%/);
  assert.match(derivedBlock, /rendered at pore level/);
  assert.doesNotMatch(derivedBlock, /infrastructure facial identity anchor/);
  assert.doesNotMatch(derivedBlock, /DERIVED_ANCHOR_PORTRAIT_REALISM_DIRECTIVE/);
});

test('follow_scene two-pass activates per image only when a derived anchor exists', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  assert.match(routeSource, /const twoPassActive = useFollowSceneTwoPass && !!anchorImage/);
  assert.match(routeSource, /identityPass: twoPassActive \? 'garment-only' : 'combined'/);
  assert.match(routeSource, /hasAnchor: !twoPassActive && shouldUseSceneGroupAnchor && !!anchorImage/);
  assert.match(routeSource, /buildFaceSwapPrompt\(faceAnalysis\.skinTone, \{/);
  assert.match(routeSource, /lowerFaceOnly/);
  assert.match(routeSource, /occluders: faceAnalysis\.occluders/);
  assert.match(routeSource, /occluderBoxes2d: faceAnalysis\.occluderBoxes2d/);
  assert.match(routeSource, /eyewearBox2d: faceAnalysis\.eyewearBox2d/);
  assert.match(routeSource, /faceBox2d: faceAnalysis\.faceBox2d/);
  assert.match(routeSource, /headPose: faceAnalysis\.headPose/);
  assert.match(routeSource, /maskImage\.geometry/);
  assert.match(routeSource, /if \(useFollowSceneTwoPass && !twoPassActive\)/);
  assert.match(routeSource, /派生锚缺失，回退单步换脸/);
  assert.doesNotMatch(routeSource, /if \(useFollowSceneTwoPass && pass1Result\.success && pass1Result\.data\)/);
});

test('follow_scene route heartbeats every long phase and gates Pass2 budgets and alpha area', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  for (const phase of [
    '正在核对余额',
    '正在分析场景肤色',
    '正在生成场景换装',
    '正在定位面部区域',
    '正在替换模特面容',
    '正在融合面部',
    '正在精修面部',
  ]) {
    assert.match(routeSource, new RegExp(phase));
  }
  assert.match(routeSource, /REQUEST_SOFT_BUDGET_MS = 540_000/);
  assert.match(routeSource, /PASS2_TOTAL_BUDGET_MS = 240_000/);
  assert.match(routeSource, /PASS2_FALLBACK_ENTRY_MS = 60_000/);
  assert.match(routeSource, /PASS2_FALLBACK_TIMEOUT_MS = 180_000/);
  assert.match(routeSource, /hasSufficientEffectiveAlphaArea\(alphaField\)/);
  assert.match(routeSource, /promptPurpose: 'faceswap'/);
  assert.match(routeSource, /allowRetryOn5xx: false/);
  assert.doesNotMatch(routeSource, /harmonizeFaceTone/);
});
