import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const api = await import('../lib/api.ts');

const followSceneWithAnchor = () => api.buildSceneGroupPrompt({
  garmentDescription: 'blush satin flutter-sleeve top with covered buttons',
  garmentCategories: ['top'],
  modelIdentityMode: 'follow_scene',
  hasAnchor: true,
});

test('follow_scene one-pass prompt carries anchor face identity plus scene-base skin/hair/body', () => {
  const prompt = followSceneWithAnchor();

  assert.match(prompt, /REPLACE #2 - Person: Replace the person with the SAME fictional FACE identity/);
  assert.match(prompt, /The anchor is the ONLY facial identity reference/);
  assert.match(prompt, /DO NOT copy the anchor's skin complexion\/tone/);
  assert.match(prompt, /paler, pinker, lighter, or less tanned skin is a FAILURE/);
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

  assert.match(withoutAnchor, /take the new model's lip outline and cupid's bow/);
  assert.doesNotMatch(withoutAnchor, /take the anchor's lip outline/);
});

test('worn accessories stay locked in the one-pass prompt', () => {
  const prompt = followSceneWithAnchor();

  assert.match(prompt, /Keep EVERY existing accessory \(headwear\/hat, sunglasses\/eyeglasses, bag, jewelry, belt, watch, scarf, shoes\)/);
  assert.match(prompt, /NEVER remove, lift, or reposition it to reveal the new face/);
});

test('two-pass face swap architecture is fully retired', () => {
  const apiSource = fs.readFileSync('lib/api.ts', 'utf8');
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
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const derivedStart = routeSource.indexOf('function buildDerivedAnchorPortraitPrompt');
  const derivedEnd = routeSource.indexOf('// ═════════════════', derivedStart);
  const derivedBlock = routeSource.slice(derivedStart, derivedEnd);

  assert.ok(derivedStart > -1);
  assert.match(derivedBlock, /Head and shoulders/);
  assert.match(derivedBlock, /85mm lens/);
  assert.match(derivedBlock, /face filling roughly 40%/);
  assert.match(derivedBlock, /rendered at pore level/);
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

  assert.match(taskSource, /const finalRemaining = Math\.max\(0, grandTotal - successCount\)/);
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
  assert.match(routeSource, /const anchorForClient = await shrinkAnchorForClient\(anchorResult\.data\)/);
  assert.match(routeSource, /push\('anchor', \{ imageData: anchorForClient\.data, mimeType: anchorForClient\.mimeType \}\)/);
  // fail-open：压缩异常绝不能影响出图链路
  assert.match(postSource, /\} catch \{\s*\n\s*return \{ data: b64, mimeType: 'image\/png' \};/);
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
