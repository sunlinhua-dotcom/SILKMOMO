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

test('buildFaceSwapPrompt adds lower-face identity rules for eyewear occlusion', () => {
  const prompt = api.buildFaceSwapPrompt(undefined, { occluders: ['sunglasses'] });

  assert.match(prompt, /identity MUST change through the visible lower face/);
  assert.match(prompt, /different lip outline and cupid's bow/);
  assert.match(prompt, /different mouth width/);
  assert.match(prompt, /different philtrum length/);
  assert.match(prompt, /different chin point and jaw angle/);
  assert.match(prompt, /different lower-cheek contour/);
  assert.match(prompt, /Reproducing the scene-base person's lips, mouth width, jawline, or chin is a FAILURE/);
});

test('derived follow-scene anchor uses fashion portrait realism instead of global blemish directive', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const directiveStart = routeSource.indexOf('const DERIVED_ANCHOR_PORTRAIT_REALISM_DIRECTIVE');
  const derivedStart = routeSource.indexOf('function buildDerivedAnchorPortraitPrompt');
  const derivedEnd = routeSource.indexOf('// ═════════════════', derivedStart);
  const derivedBlock = routeSource.slice(directiveStart, derivedEnd);

  assert.ok(directiveStart > -1);
  assert.match(derivedBlock, /24-28 year old agency-signed high-fashion editorial model/);
  assert.match(derivedBlock, /striking, camera-ready features/);
  assert.match(derivedBlock, /fresh rested skin/);
  assert.match(derivedBlock, /professional clean retouching/);
  assert.match(derivedBlock, /no heavy freckles/);
  assert.match(derivedBlock, /\$\{DERIVED_ANCHOR_PORTRAIT_REALISM_DIRECTIVE\}/);
  assert.doesNotMatch(derivedBlock, /\$\{FACE_REALISM_DIRECTIVE\}/);
});

test('follow_scene two-pass activates per image only when a derived anchor exists', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  assert.match(routeSource, /const twoPassActive = useFollowSceneTwoPass && !!anchorImage/);
  assert.match(routeSource, /identityPass: twoPassActive \? 'garment-only' : 'combined'/);
  assert.match(routeSource, /hasAnchor: !twoPassActive && shouldUseSceneGroupAnchor && !!anchorImage/);
  assert.match(routeSource, /buildFaceSwapPrompt\(faceAnalysis\.skinTone, \{/);
  assert.match(routeSource, /lowerFaceOnly/);
  assert.match(routeSource, /occluders: faceAnalysis\.occluders/);
  assert.match(routeSource, /if \(useFollowSceneTwoPass && !twoPassActive\)/);
  assert.match(routeSource, /派生锚缺失，回退单步换脸/);
  assert.doesNotMatch(routeSource, /if \(useFollowSceneTwoPass && pass1Result\.success && pass1Result\.data\)/);
});
