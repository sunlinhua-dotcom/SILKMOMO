import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import crypto from 'node:crypto';

const api = await import('../lib/api.ts');

test('fresh picker writes the selected library face as a source-marked anchor', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const db = fs.readFileSync('lib/db.ts', 'utf8');

  assert.match(source, /modelIdentityMode === 'fresh' && chosenFaceId/);
  assert.match(source, /type: 'anchor', data: original\.image/);
  assert.match(source, /modelFaceChosen: true, modelFaceId: chosenFaceId/);
  assert.match(db, /modelFaceId\?: string/);
  assert.ok(
    source.indexOf('await prepareProjectImageSlot(projectId as number)') < source.indexOf("projectId, type: 'anchor'"),
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
  assert.match(library, /const where = \{ userId, favorite: true \}/);
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

test('fresh anchor is explicitly complete while follow_scene keeps the scene person', () => {
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
  assert.match(follow, /same person/i);
  assert.doesNotMatch(follow, /Eurasian|East-Asian|partial face swap/i);
  assert.match(fresh, /visible skin complexion.*anchor/i);
  assert.doesNotMatch(fresh, /Sample the scene-base person's neck, throat and chest/);
});

test('fresh without an anchor gives complexion ownership to the new fictional model', () => {
  const fresh = api.buildSceneGroupPrompt({
    garmentDescription: 'silk dress', modelIdentityMode: 'fresh', hasAnchor: false,
  });

  assert.match(fresh, /new fictional model identity.*complexion/i);
  assert.doesNotMatch(fresh, /Keep the same pose, body position, skin-tone range/);
  assert.doesNotMatch(fresh, /Sample the scene-base person's neck, throat and chest/);
});

test('fresh renders texture at its identity complexion brightness and rejects a lighter face', () => {
  for (const hasAnchor of [false, true]) {
    const fresh = api.buildSceneGroupPrompt({
      garmentDescription: 'silk dress', modelIdentityMode: 'fresh', hasAnchor,
    });

    assert.match(fresh, /Render every pore, texture break and film grain AT .* brightness/i);
    assert.match(fresh, /face that reads lighter, paler, cooler, or flatter than .* neck\/chest .* failure/i);
  }
});

test('09-04 用户拍板「就是场景图里那个人」后，follow_scene 新文本保持字节级稳定', () => {
  const cases = [
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: false }, '9be0a79bf5fbd3975d9319c156b074778072b5d5ab0055fac027adfb92318a00'],
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: true }, 'f04d3dd6f48007f76e5ab49b558a6c898d043493944fbafe76f97717dc001c6f'],
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: true, hasReplacementAccessory: true, isRegeneration: true, sceneGroupMode: 'products', productLabel: 'Set A', garmentCategories: ['dress'], customPrompt: 'keep rain' }, 'bc17e539f16966ab13e08534c4f7316bc7e8d07feb5a092c6d1aeccac05ee463'],
  ];

  for (const [options, expectedHash] of cases) {
    const prompt = api.buildSceneGroupPrompt(options);
    assert.equal(crypto.createHash('sha256').update(prompt).digest('hex'), expectedHash);
    assert.match(prompt, /same person/i);
    assert.doesNotMatch(prompt, /Eurasian|East-Asian|partial face swap/i);
  }

  const derivedPrompt = api.buildDerivedAnchorPortraitPrompt();
  assert.equal(
    crypto.createHash('sha256').update(derivedPrompt).digest('hex'),
    '959926577a7b3fae4a3d5d9a58cee542f20157a99be49ea2764b7e8e476f2c09',
  );
});

test('fresh prompt hashes stay byte-for-byte unchanged by the 09-04 follow_scene identity change', () => {
  const cases = [
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'fresh', hasAnchor: false }, '1feeb0c61a9fc6df7ece5502963f15f2ffe40288a5b5870dc11b4b933e802a3b'],
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'fresh', hasAnchor: true }, '7b35c8bbcb7a36ed21c6c63c458dfaaa407ba16ee031fece5c02a300d2e19ac3'],
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'fresh', hasAnchor: true, hasReplacementAccessory: true, isRegeneration: true, sceneGroupMode: 'products', productLabel: 'Set A', garmentCategories: ['dress'], customPrompt: 'keep rain' }, '4b81c93da837b5b7217bdf99977b3d8fbaab4d174d2989207a1fe49be781eb73'],
  ];

  for (const [options, expectedHash] of cases) {
    const prompt = api.buildSceneGroupPrompt(options);
    assert.equal(crypto.createHash('sha256').update(prompt).digest('hex'), expectedHash);
  }
});
