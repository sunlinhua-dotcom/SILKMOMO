import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = await import('../lib/api.ts');

test('fresh picker writes the selected library face as a source-marked anchor', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const db = fs.readFileSync('lib/db.ts', 'utf8');

  assert.match(source, /modelIdentityMode === 'fresh' && chosen/);
  assert.match(source, /type: 'anchor', data: chosen\.image/);
  assert.match(source, /modelFaceChosen: true, modelFaceId: chosen\.id/);
  assert.match(db, /modelFaceId\?: string/);
  assert.ok(
    source.indexOf('await prepareProjectImageSlot(projectId as number)') < source.indexOf("modelIdentityMode === 'fresh' && chosen"),
    '清理旧图片必须发生在写入选中 anchor 之前，否则刚写入的身份锚会被删掉',
  );
});

test('picker is rendered inside fresh and follow_scene never consumes a library choice', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');

  assert.match(source, /option\.id === 'fresh' && value === 'fresh' && freshContent/);
  assert.doesNotMatch(source, /modelIdentityMode === 'follow_scene' && chosen/);
  assert.doesNotMatch(source, /modelIdentityMode === 'follow_scene' && chosenFaceId/);
});

test('fresh without a chosen anchor prefers a random account favorite', () => {
  const route = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const library = fs.readFileSync('lib/model-face-library.ts', 'utf8');

  assert.match(route, /modelIdentityMode === 'fresh' && !anchorImage/);
  assert.match(route, /getRandomFavoriteModelFace\(auth\.userId\)/);
  assert.match(library, /where: \{ userId, favorite: true \}/);
  assert.match(library, /skip: Math\.floor\(Math\.random\(\) \* count\)/);
});

test('fresh without favorites draws from the same explicit 3/7 ethnicity recipes', () => {
  const route = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  assert.match(route, /Math\.floor\(Math\.random\(\) \* MODEL_FACE_SPECS\.length\)/);
  assert.match(route, /buildModelFacePortraitPrompt\(MODEL_FACE_SPECS\[specIndex\]\)/);
  assert.equal(api.MODEL_FACE_SPECS.filter(spec => spec.ethnicity === 'eurasian').length, 3);
  assert.equal(api.MODEL_FACE_SPECS.filter(spec => spec.ethnicity === 'western').length, 7);
  assert.match(api.buildModelFacePortraitPrompt(api.MODEL_FACE_SPECS[0]), /mixed European and East Asian heritage/);
  assert.match(api.buildModelFacePortraitPrompt(api.MODEL_FACE_SPECS[3]), /white European \/ North American woman/);
});

test('fresh anchor is explicitly complete while follow_scene semantics stay partial', () => {
  const fresh = api.buildSceneGroupPrompt({
    garmentDescription: 'silk dress', modelIdentityMode: 'fresh', hasAnchor: true,
  });
  const follow = api.buildSceneGroupPrompt({
    garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: true,
  });

  assert.match(fresh, /COMPLETE IDENTITY ANCHOR/);
  assert.match(fresh, /face, hair, hairline, complexion, and age/);
  assert.doesNotMatch(follow, /COMPLETE IDENTITY ANCHOR/);
  assert.match(follow, /DO NOT copy the anchor's skin complexion\/tone/);
  assert.match(follow, /scene-base person's exact skin tone/);
});
