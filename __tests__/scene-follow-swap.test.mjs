import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';

const api = await import('../lib/api.ts');
const postprocess = await import('../lib/postprocess.ts');
const recovery = await import('../lib/generation-recovery.ts');

// 0906 板块拆分：提示词构造器已从 lib/api.ts 搬到 lib/prompts/*，lib/api.ts 只剩 re-export 桶。
// 对「源码文本」的断言必须读拆分后的真身文件——只读桶的话 doesNotMatch 会永远为真，等于没测。
const PROMPT_SOURCE_FILES = [
  'lib/api.ts',
  'lib/prompts/shared.ts',
  'lib/prompts/product.ts',
  'lib/prompts/scene.ts',
  'lib/prompts/group.ts',
  'lib/prompts/face-anchor.ts',
];
const readPromptSources = () => PROMPT_SOURCE_FILES.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const followSceneWithAnchor = () => api.buildSceneGroupPrompt({
  garmentDescription: 'blush satin flutter-sleeve top with covered buttons',
  garmentCategories: ['top'],
  modelIdentityMode: 'follow_scene',
  hasAnchor: true,
});

test('follow_scene one-pass prompt keeps the scene person and uses the anchor to confirm that same identity', () => {
  const prompt = followSceneWithAnchor();

  assert.match(prompt, /same person/i);
  assert.match(prompt, /face identity must match the anchor/i);
  assert.match(prompt, /must not replace her with another person/i);
  assert.match(prompt, /DO NOT copy the anchor's skin complexion\/tone/);
  assert.match(prompt, /paler, pinker, lighter, or less tanned skin is a FAILURE/);
  assert.doesNotMatch(prompt, /Eurasian|East-Asian|partial face swap/i);
});

test('skin tone continuity block outranks the realism block and pins texture to the neck brightness', () => {
  const prompt = followSceneWithAnchor();

  assert.match(prompt, /SKIN TONE CONTINUITY \(this outranks the realism block below\)/);
  assert.match(prompt, /the new face is the same skin as the neck directly beneath it/);
  assert.match(prompt, /no visible step, edge, or tonal seam anywhere along the jawline/);
  assert.match(prompt, /Render every pore, texture break and film grain AT the neck's own brightness/);
  assert.match(prompt, /never lighten, cool down, or flatten the face in order to make its texture visible/);

  // 顺序很重要：连续性必须出现在真实感块之前，后者才是被压制的一方
  assert.ok(
    prompt.indexOf('SKIN TONE CONTINUITY') < prompt.indexOf('REALISM (highest priority'),
    'SKIN TONE CONTINUITY 必须排在 FACE_REALISM_DIRECTIVE 之前',
  );
});

test('eyewear occlusion falls back to lower-face identity without needing face detection', () => {
  const prompt = followSceneWithAnchor();

  assert.match(prompt, /If the scene-base person's eyes are behind sunglasses or eyeglasses/);
  assert.match(prompt, /take the anchor's lip outline and cupid's bow/);
  assert.match(prompt, /mouth width, philtrum length, chin point, jaw angle, and lower-cheek contour/);
  assert.match(prompt, /The eyewear itself stays exactly where it is, untouched, and no eye is drawn behind it/);
});

test('lower-face identity source follows whether an anchor is attached', () => {
  const withoutAnchor = api.buildSceneGroupPrompt({
    garmentDescription: 'blush satin top',
    modelIdentityMode: 'follow_scene',
    hasAnchor: false,
  });

  assert.match(withoutAnchor, /match the scene-base person's lip outline and cupid's bow/);
  assert.doesNotMatch(withoutAnchor, /take the anchor's lip outline/);
});

test('worn accessories stay locked in the one-pass prompt', () => {
  const prompt = followSceneWithAnchor();

  assert.match(prompt, /Keep EVERY existing accessory \(headwear\/hat, sunglasses\/eyeglasses, bag, jewelry, belt, watch, scarf, shoes\)/);
  assert.match(prompt, /NEVER remove, lift, or reposition it to reveal the new face/);
});

test('two-pass face swap architecture is fully retired', () => {
  const apiSource = readPromptSources();
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  // 提示词构造器：不再有 Pass1 只换衣的分支
  assert.doesNotMatch(apiSource, /identityPass/);
  assert.doesNotMatch(apiSource, /isGarmentOnlyPass/);
  assert.doesNotMatch(apiSource, /buildFaceSwapPrompt/);
  // 注意：'garment-only' 这个词在正常提示词里合法出现（product reference images are
  // garment-only references），只断言两步走那个取值已消失。
  assert.doesNotMatch(apiSource, /'garment-only'/);

  // 路由：不再有第二遍换脸、本地合成、蒙版重画
  assert.doesNotMatch(routeSource, /twoPassActive/);
  assert.doesNotMatch(routeSource, /useFollowSceneTwoPass/);
  assert.doesNotMatch(routeSource, /swapFaceVia302/);
  assert.doesNotMatch(routeSource, /buildFaceAlphaField|alignSwapTone|compositeFaceRegion|createFaceEditMask/);
  assert.doesNotMatch(routeSource, /PASS2_TOTAL_BUDGET_MS|PASS2_FALLBACK_ENTRY_MS/);

  // 退役模块已从仓库移除
  assert.equal(fs.existsSync('lib/face-swap.ts'), false);
  assert.equal(fs.existsSync('lib/face-mask.ts'), false);
});

test('follow_scene generates in a single backend call with the anchor attached', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  assert.match(routeSource, /hasAnchor: shouldUseSceneGroupAnchor && !!anchorImage/);
  assert.match(routeSource, /anchorImage: shouldUseSceneGroupAnchor \? anchorImage : undefined/);
  assert.match(routeSource, /sceneAsEditBase: true/);
  assert.match(routeSource, /timings\.t_generate = Date\.now\(\) - generateStart/);

  // 组图内每张只调一次生图；首张成功后充当后续的锚
  const generateCalls = routeSource.match(/'正在生成场景换装'/g) || [];
  assert.equal(generateCalls.length, 1);
  assert.match(routeSource, /if \(shouldUseSceneGroupAnchor && !anchorImage\) \{\n\s+anchorImage = \{ data: result\.data/);
});

test('derived follow-scene anchor uses the final head-and-shoulders identity portrait prompt', () => {
  // 提示词已从 route 挪到 lib/prompts/face-anchor.ts，让「自动创建的锚」与「脸库让用户挑的脸」
  // 共用同一份，避免两处各写一份随时间漂移。
  const apiSource = fs.readFileSync('lib/prompts/face-anchor.ts', 'utf8');
  const derivedStart = apiSource.indexOf('export function buildDerivedAnchorPortraitPrompt');
  const derivedBlock = apiSource.slice(derivedStart);

  assert.ok(derivedStart > -1);
  assert.match(derivedBlock, /Head and shoulders/);
  assert.match(derivedBlock, /85mm lens/);
  assert.match(derivedBlock, /face filling roughly 40%/);
  assert.match(derivedBlock, /rendered at pore level/);
  assert.match(derivedBlock, /same fictional woman shown in the uploaded scene reference image/);
  assert.match(derivedBlock, /Strictly match the ethnicity, face shape, facial features, hair color, and hairstyle/);
  assert.match(derivedBlock, /apparent age matches the scene reference/i);
  assert.match(derivedBlock, /Only clean commercial retouching is allowed/);
  assert.match(derivedBlock, /do not change any facial feature, facial proportion, or recognizable appearance/i);
  assert.match(derivedBlock, /One large soft source from the front left, a weak fill on the right/);
  assert.doesNotMatch(derivedBlock, /24-28|beautification is allowed/i);
  assert.doesNotMatch(derivedBlock, /subtle East-Asian eyelid|Eurasian mixed European-Asian/);
});

test('follow_scene derived anchor alone selects its configurable Flash model', () => {
  const backendSource = fs.readFileSync('lib/image-backends.ts', 'utf8');
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  assert.match(backendSource, /DERIVED_ANCHOR_MODEL.*process\.env\.DERIVED_ANCHOR_MODEL.*gemini-3\.1-flash-image-preview/);
  assert.match(backendSource, /promptPurpose\?: 'compose' \| 'faceswap' \| 'derived-anchor'/);
  assert.match(routeSource, /promptPurpose: 'derived-anchor'/);
  assert.match(routeSource, /sceneRefImages: \[sceneRefImages\[0\]\]/);
  assert.match(routeSource, /buildDerivedAnchorPortraitPrompt\(derivedAnchorSkinTone\)/);
  assert.doesNotMatch(routeSource, /buildDerivedAnchorPortraitPrompt\(derivedAnchorSkinTone\s*,/);
  assert.match(backendSource, /input\.promptPurpose === 'derived-anchor'/);
  assert.match(backendSource, /return backend === 'openai' \? OPENAI_MODEL : GEMINI_MODEL/);
});

test('every remaining long phase still heartbeats', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  for (const phase of ['正在核对余额', '正在分析场景肤色', '正在生成场景换装']) {
    assert.match(routeSource, new RegExp(phase));
  }
  assert.doesNotMatch(routeSource, /harmonizeFaceTone/);
});

// 0731 客户「一直出错」的三条修复，各自锁一个不变量
test('no long upstream await is left without a data: heartbeat', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');

  // 裸调用（不经 withPhaseBeat）会造成一段只有 `: keep-alive` 注释行、没有 `data:` 事件的
  // 真空窗，客户端事件看门狗喂不到 → 慢的那一张被主动 abort。
  assert.doesNotMatch(routeSource, /await generateBackendImage\(/);
  assert.doesNotMatch(routeSource, /await analyzeProductImage\(/);
  for (const phase of [
    '正在分析服装特征',
    '正在创建新模特身份锚',
    '正在生成场景图',
  ]) {
    assert.match(routeSource, new RegExp(`'${phase}'`));
  }
});

test('client event watchdog stays above the server single-shot ceiling', () => {
  const backendSource = fs.readFileSync('lib/image-backends.ts', 'utf8');
  const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  const serverMs = Number(backendSource.match(/const OPENAI_TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''));
  const clientMs = Number(taskSource.match(/openai: ([\d_]+),/)[1].replace(/_/g, ''));

  // 客户端若先于服务端超时，正常的慢请求会被误杀成「连接中断」，
  // 服务端随后记成 client disconnected before delivery（0731 客户实例 166.7s）。
  assert.ok(
    clientMs > serverMs,
    `客户端事件看门狗 ${clientMs}ms 必须大于服务端单张超时 ${serverMs}ms`,
  );
});

test('finalization recomputes the remaining count instead of reusing a mid-run snapshot', () => {
  const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  assert.match(taskSource, /const recovery = await recoverPendingImages\(taskId, expectedShotIndexes\)/);
  assert.match(taskSource, /const finalRemaining = outcome\.remaining\.length/);
  // 全部出齐时红条要被清掉，而不是继续挂着中途那条过期文案
  assert.match(taskSource, /setErrorMessage\(persistedError \?\? null\)/);
  assert.match(taskSource, /buildFriendlyConnectionErrorMessage\(successCount, finalRemaining\)/);
});

test('anchor pushed to the client is shrunk server-side first', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const postSource = fs.readFileSync('lib/postprocess.ts', 'utf8');

  // 锚图会被客户端在「每一张」请求里回传，服务端收到时本来就会归一化成 1434x1920 JPEG。
  // 原样推送 = 客户端白下载一条 2.9MB 的大 data: 行（0731 实测），且大 data: 行会让
  // 事件看门狗在下载期间收不到完整事件。
  assert.match(postSource, /export async function shrinkAnchorForClient/);
  assert.match(routeSource, /const anchorForClient = await shrinkAnchorForClient\(anchorResult\.data, anchorImage\.mimeType\)/);
  assert.match(routeSource, /await deliverAnchor\(push, auth\.userId, taskId, anchorForClient\.data, anchorForClient\.mimeType\)/);
  // fail-open：压缩异常绝不能影响出图链路
  assert.match(postSource, /\} catch \{\s*\n\s*return \{ data: b64, mimeType: inputMimeType \};/);
});

test('anchor shrinking preserves the real input MIME type on both fail-open paths', async () => {
  const jpeg = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
  }).jpeg({ quality: 20 }).toBuffer();
  const small = await postprocess.shrinkAnchorForClient(jpeg.toString('base64'), 'image/jpeg');
  assert.equal(small.mimeType, 'image/jpeg');

  const invalid = await postprocess.shrinkAnchorForClient('not-an-image', 'image/jpeg');
  assert.deepEqual(invalid, { data: 'not-an-image', mimeType: 'image/jpeg' });
});

test('garment analysis failure is no longer swallowed silently', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const aiSource = fs.readFileSync('lib/ai-assistant.ts', 'utf8');

  // 分析挂掉时 prompt 会少一整段服装描述，出图保真度下降而前端完全无感；
  // 线上必须留痕，否则只能靠猜。
  assert.doesNotMatch(routeSource, /\} catch \{ \/\* skip \*\/ \}/);
  assert.match(routeSource, /缺 garmentDescription/);
  // 上游拥塞时 30s 不够（0731 实测反复超时）；心跳补齐后放宽是安全的
  const lite = Number(aiSource.match(/const LITE_TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''));
  assert.ok(lite >= 60_000, `AI Lite 超时 ${lite}ms 过短`);
});

test('generated images are handed off by id, not pushed through SSE', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  // 4~5MB 的图作为一条 data: 行是 0731 客户「生成失败」的根因；改为只推 id。
  assert.doesNotMatch(routeSource, /push\('result', \{[\s\S]{0,120}imageData: result\.data/);
  assert.match(routeSource, /async function deliverResult/);
  assert.match(routeSource, /const prepared = await preparePendingDelivery\(storePendingImage/);
  assert.match(routeSource, /\.\.\.prepared\.payload/);
  // fail-open：交接缓冲写失败必须回退直推，不能让已扣费的图丢掉
  assert.match(routeSource, /storePendingImage/);

  // 客户端：按 id 取图 → 落库 → 释放
  assert.match(taskSource, /async function fetchPendingImage/);
  assert.match(taskSource, /if \(pendingId\) void releasePendingImage\(pendingId\)/);
  // 断网丢图的根治点：进任务页先补拉
  assert.match(taskSource, /await recoverPendingImages\(taskId\)/);
});

test('pending image API scopes every read and delete to the owner', () => {
  const libSource = fs.readFileSync('lib/pending-image.ts', 'utf8');

  // 越权取别人的图是这条链路最直接的风险，读和删都必须带 userId
  assert.match(libSource, /findFirst\(\{\s*\n\s*where: \{ id, userId \}/);
  assert.match(libSource, /deleteMany\(\{ where: \{ id, userId \} \}\)/);
  // 只在客户端确认落库后才删，避免响应中途断掉就永久丢图
  assert.match(libSource, /TTL/);
});

test('disconnect auto-continues once, only for stalls, and never for fatal errors', () => {
  const base = { remaining: [2], alreadyRetried: false };
  assert.equal(recovery.shouldScheduleAutomaticFill({
    ...base,
    lastErrorWasStall: true,
    fatalStop: false,
  }), true);
  assert.equal(recovery.shouldScheduleAutomaticFill({
    ...base,
    lastErrorWasStall: false,
    fatalStop: false,
  }), false);
  assert.equal(recovery.shouldScheduleAutomaticFill({
    ...base,
    lastErrorWasStall: true,
    fatalStop: true,
  }), false);
});

test('garment analysis is reused across chunks instead of re-run every time', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  // swap 模式原本每块都对同一张产品图重跑一次分析（6 张图＝6 次上游调用）
  assert.match(routeSource, /if \(sceneGroupMode === 'swap' && reusableGarmentDescription\)/);
  assert.match(routeSource, /push\('garment', \{ description: analysis\.description \}\)/);
  // 入参限长，防止被塞超长文本进 prompt
  assert.match(routeSource, /clientGarmentDescription\.trim\(\)\.slice\(0, 2000\)/);
  assert.match(taskSource, /garmentDescription: garmentDescriptionForChunk \|\| undefined/);
});

test('mixed-garment warning rides on the existing analysis call (no extra upstream cost)', () => {
  const aiSource = fs.readFileSync('lib/ai-assistant.ts', 'utf8');
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  // 关键约束：不新增上游调用、不额外扣费 —— 其余产品图搭在已有的那次分析里一起送
  assert.match(aiSource, /extraImages: Array<\{ data: string; mimeType: string \}> = \[\]/);
  assert.match(aiSource, /extraImages\.slice\(0, 3\)\.map/);
  assert.match(routeSource, /productImages\.slice\(1\)\.map/);

  // 单图无从比对，必须恒为 false，避免凭空吓用户
  assert.match(aiSource, /const mixed = extraImages\.length > 0 && parsed\.mixed === true;/);

  // 是告警不是失败：黄条、不打断生成，且与错误提示分开渲染
  assert.match(routeSource, /push\('warning', \{ kind: 'mixed-garment'/);
  assert.match(taskSource, /setWarningMessage\(msg\.trim\(\)\)/);
  assert.match(taskSource, /这次上传的产品图像是不止一件单品/);
});

test('face library ships 3 eurasian + 7 western with genuinely distinct face shapes', () => {
  const apiSource = fs.readFileSync('lib/prompts/face-anchor.ts', 'utf8');

  const specsBlock = apiSource.slice(apiSource.indexOf('export const MODEL_FACE_SPECS'));
  const eurasian = (specsBlock.match(/ethnicity: 'eurasian'/g) || []).length;
  const western = (specsBlock.match(/ethnicity: 'western'/g) || []).length;
  assert.equal(eurasian, 3, '亚欧混血应为 3 张');
  assert.equal(western, 7, '欧美应为 7 张');

  // 「完全不一样的脸型」：每张必须写死脸型，只说「换一张脸」实测会出一批雷同的脸
  for (const shape of ['round face', 'long oval face', 'heart-shaped face', 'square face', 'diamond face']) {
    assert.ok(specsBlock.includes(shape), `缺少脸型：${shape}`);
  }
  // 欧美档必须明确排除东亚长相，否则底模会漂回混血脸
  assert.match(apiSource, /must NOT read as East Asian or mixed-Asian/);

  // 09-04 用户拍板：自动派生锚必须就是场景图里那个人，不再继承脸库的族裔配方。
  const derivedBlock = apiSource.slice(
    apiSource.indexOf('export function buildDerivedAnchorPortraitPrompt'),
    apiSource.indexOf('export type ModelFaceEthnicity'),
  );
  assert.match(derivedBlock, /same fictional woman shown in the uploaded scene reference image/);
  assert.doesNotMatch(derivedBlock, /Eurasian|East-Asian/);
});
