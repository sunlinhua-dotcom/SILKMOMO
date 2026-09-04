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
  assert.match(follow, /anchor confirms face/i);
  assert.match(follow, /SKIN TONE CONTINUITY/);
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

test('09-04 提示词优化后，follow_scene 新文本保持字节级稳定', () => {
  const cases = [
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: false }, '925924fc08cf33ba50e916ebbf0477a8e6ad01d9fb6d6fa8676c8a29763cd12a'],
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: true }, '155239846787e3b376b6fa2af32bf67ea3c30f413ae0160d41f22f9fb3bc8650'],
    [{ garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: true, hasReplacementAccessory: true, isRegeneration: true, sceneGroupMode: 'products', productLabel: 'Set A', garmentCategories: ['dress'], customPrompt: 'keep rain' }, 'ee6dd7af35706cd5697b540c03f672d5fd61644a0589e0037ed72ce4f4bc6ea3'],
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
    'b681ea18d5dabd00cfeb259519a9fe8c8388bdac72478014cecce898cc878f22',
  );
});

test('09-04 提示词优化合并肤色裁决并移除人物替换框架与派生锚美化', () => {
  const follow = api.buildSceneGroupPrompt({
    garmentDescription: 'silk dress', modelIdentityMode: 'follow_scene', hasAnchor: true,
  });
  const derived = api.buildDerivedAnchorPortraitPrompt();

  assert.ok((follow.match(/paler/gi) || []).length <= 2, 'follow_scene 中 paler 不应重复堆叠');
  assert.ok((follow.match(/pinker/gi) || []).length <= 2, 'follow_scene 中 pinker 不应重复堆叠');
  assert.match(follow, /Render every pore, texture break and film grain AT the neck's own brightness/);
  assert.match(follow, /A face that reads lighter, paler, cooler, or flatter than the neck below it is a failure/);
  assert.doesNotMatch(follow, /REPLACE #2 - Person/);
  assert.match(follow, /PERSON: unchanged .* same person as scene-base; anchor confirms face/i);

  assert.doesNotMatch(derived, /24-28/);
  assert.doesNotMatch(derived, /beautification is allowed/i);
  assert.match(derived, /apparent age matches the scene reference/i);
  assert.match(derived, /clean commercial retouching/i);
  assert.match(derived, /skin exposure and brightness.*neck and chest.*scene reference/i);
  assert.match(derived, /no studio-style brightening/i);
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
