import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('lookbook defaults to follow_scene and shows that option first', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const optionsIndex = source.indexOf('const MODEL_IDENTITY_OPTIONS');
  const firstFollowSceneIndex = source.indexOf("id: 'follow_scene'", optionsIndex);
  const firstFreshIndex = source.indexOf("id: 'fresh'", optionsIndex);

  assert.match(source, /useState<ModelIdentityMode>\('follow_scene'\)/);
  assert.ok(firstFollowSceneIndex !== -1 && firstFreshIndex !== -1);
  assert.ok(firstFollowSceneIndex < firstFreshIndex, 'follow_scene option should render before fresh');
});

test('lookbook swap tab places model before optional accessories with contiguous numbering', () => {
  const source = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const modelIndex = source.indexOf('③ 模特');
  const accessoryIndex = source.indexOf('④ 替换附件（选填）');
  const outputIndex = source.indexOf('⑤ 输出尺寸');

  assert.ok(modelIndex !== -1, 'swap tab should render ③ 模特');
  assert.ok(accessoryIndex !== -1, 'swap tab should render ④ 替换附件（选填）');
  assert.ok(outputIndex !== -1, 'swap tab should render ⑤ 输出尺寸');
  assert.ok(modelIndex < accessoryIndex, 'model section should appear before accessories');
  assert.ok(accessoryIndex < outputIndex, 'accessories should appear before output size');
});

test('pending task parameter panel hides model selectors for follow_scene group tasks', () => {
  const source = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');
  const pendingStart = source.indexOf("{project.status === 'pending' && !generating && (");
  const buttonStart = source.indexOf("{moduleType === 'product' && getShotCount() > 1 ?", pendingStart);
  const pendingPanel = source.slice(pendingStart, buttonStart);
  const modelSelectorIndex = pendingPanel.indexOf('<ModelSelector');

  assert.match(pendingPanel, /isFollowSceneGroupTask \? \(/);
  assert.match(pendingPanel, /肤色·体型·发型跟随场景图/);
  assert.ok(modelSelectorIndex !== -1, 'pending panel should still render ModelSelector for non-follow_scene tasks');
  assert.ok(
    pendingPanel.lastIndexOf('isFollowSceneGroupTask ? (', modelSelectorIndex) !== -1,
    'pending ModelSelector must be in the non-follow_scene branch',
  );
});

test('task generation watchdog isolates stalls to one chunk and consumes phase heartbeats', () => {
  const source = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');
  const chunkLoop = source.indexOf('for (let chunkIdx = 0; chunkIdx < genChunks.length; chunkIdx++)');
  const chunkController = source.indexOf('const chunkController = new AbortController()', chunkLoop);
  const chunkCatch = source.indexOf('if (stalledOut !== null)', chunkController);
  const nextChunk = source.indexOf('continue;', chunkCatch);

  assert.match(source, /const STALL_BYTES_MS = 120_000/);
  // 事件看门狗的具体数值不写死：它必须跟着服务端单张超时走，
  // 该不变量由 scene-follow-swap.test.mjs 的「client event watchdog」一条守住。
  assert.match(source, /openai: [\d_]+,/);
  assert.ok(chunkLoop > -1 && chunkController > chunkLoop);
  assert.ok(chunkCatch > chunkController && nextChunk > chunkCatch);
  assert.match(source, /doneSoFar \+= chunkShots\.length/);
  assert.match(source, /payload\.heartbeat === true/);
  assert.match(source, /setWaitingMessage\(payload\.message\)/);
  // anchor 事件到手后必须先压再当作后续块的锚（具体覆盖面见下方
  // 「every anchor source is compressed」一条）
  assert.match(source, /toCompressedAnchor\(\{ data: imageData, mimeType: anchorMime \}\)/);
  // 服务端已先压过一版并给出真实类型，不能再写死 png
  assert.match(source, /payload\.mimeType === 'string'/);
});

test('every anchor source is compressed before it is re-uploaded per shot', () => {
  const source = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  // 锚图在每一张请求里都要重传。0731 线上实测：补齐路径（「生成剩余 N 张」）
  // 直接拿全尺寸结果图当锚，服务端收到 2926199B image/png 1792x2400，
  // 压完只剩 241KB——即每张白背约 3.9MB base64 上行，把请求拖长到撞看门狗，
  // 用户再点「生成剩余」又走同一条路，越点越糟。
  assert.match(source, /const ANCHOR_COMPRESS_THRESHOLD_CHARS = 700_000/);
  assert.match(source, /async function toCompressedAnchor/);
  // 幂等：已经压过的直接原样返回，避免每次跑都重新编码一次
  assert.match(source, /if \(source\.data\.length < ANCHOR_COMPRESS_THRESHOLD_CHARS\) return source;/);

  const assignments = source
    .split('\n')
    .filter(line => /\b(anchorForChunk|groupAnchor|groupAnchorForChunk)\s*=\s*[^=]/.test(line))
    .filter(line => !/^\s*(let|const)\s/.test(line.trim()) || /=\s*\{/.test(line));

  for (const line of assignments) {
    const assignsPayload = /\{\s*data:/.test(line);
    if (!assignsPayload) continue;
    assert.ok(
      /toCompressedAnchor/.test(line),
      `锚图赋值必须过压缩，漏网的一行: ${line.trim()}`,
    );
  }
});

test('event watchdog does not count down while a large data: line is still arriving', () => {
  const source = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  // result 事件是一张 4~5MB base64 图，整张就是一条 data: 行。下载期间解析不出完整
  // 事件，lastEventAt 会冻住，事件看门狗就在「下载一张图」的过程中把连接掐了——
  // 服务端记成 client disconnected before delivery，而图其实已经生成成功。
  // 0731 线上实测：t_generate=56.3s 就完成，客户端 105s 后才收到图。
  assert.match(source, /if \(buffer\.length > 0\) lastEventAt = Date\.now\(\);/);

  // 该复位必须发生在「切完整行、把残行放回 buffer」之后，否则判断的是上一轮的残留
  const splitAt = source.indexOf("buffer = lines.pop() ?? '';");
  const resetAt = source.indexOf('if (buffer.length > 0) lastEventAt = Date.now();');
  assert.ok(splitAt > -1 && resetAt > splitAt, '半条事件的进度复位必须排在 buffer 重切之后');
});

test('model face library lets the user pick the identity, and stays optional', () => {
  const lookbook = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const faceRoute = fs.readFileSync('app/api/model-face/route.ts', 'utf8');

  // 一次一张、串行生成：满足「生图串行」约束，且单次请求短、进度可见
  assert.match(faceRoute, /export async function POST/);
  assert.match(lookbook, /for \(let specIndex = 0; specIndex < MODEL_FACE_COUNT; specIndex\+\+\)/);
  // 配方固定在服务端，客户端只传下标 —— 免费接口不能变成任意 prompt 的入口
  assert.match(faceRoute, /MODEL_FACE_SPECS\[specIndex\]/);
  assert.doesNotMatch(faceRoute, /rawVariation/);
  // 走 GPT Image 2（老板指定），画质 medium 压时间与成本
  assert.match(faceRoute, /\}, 'openai'\)/);
  assert.match(faceRoute, /quality: 'medium'/);

  // 选填：不挑也能生成，行为与以前一致
  assert.match(lookbook, /选一张模特脸（选填）/);
  assert.match(lookbook, /chosenFaceIndex !== null && faceCandidates\[chosenFaceIndex\]/);

  // 免费但限流，防止被反复点
  assert.match(faceRoute, /isRateLimited/);
  assert.match(faceRoute, /bumpRateLimit/);
});

test('model face requests have ordered deadlines and preserve completed faces for retry', () => {
  const lookbook = fs.readFileSync('app/lookbook/page.tsx', 'utf8');
  const faceRoute = fs.readFileSync('app/api/model-face/route.ts', 'utf8');

  const serverMs = Number(
    faceRoute.match(/const MODEL_FACE_UPSTREAM_TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''),
  );
  const clientMs = Number(
    lookbook.match(/const MODEL_FACE_CLIENT_TIMEOUT_MS = ([\d_]+)/)[1].replace(/_/g, ''),
  );

  assert.ok(clientMs > serverMs, `客户端截止线 ${clientMs}ms 必须大于服务端 ${serverMs}ms`);
  assert.match(faceRoute, /timeoutMs: MODEL_FACE_UPSTREAM_TIMEOUT_MS/);
  assert.match(lookbook, /new AbortController\(\)/);
  assert.match(lookbook, /controller\.abort\(\)/);
  assert.match(lookbook, /clearTimeout\(timeoutId\)/);

  // 已成功的脸只能追加，失败时记录当前配方，让按钮能从这一张继续。
  assert.doesNotMatch(lookbook, /setFaceCandidates\(\[\]\)/);
  assert.match(lookbook, /setFaceRetryIndex\(specIndex\)/);
  assert.match(lookbook, /重试第 \$\{faceRetryIndex \+ 1\} 张/);
});

test('model face button reports the current item and elapsed seconds', () => {
  const lookbook = fs.readFileSync('app/lookbook/page.tsx', 'utf8');

  assert.match(lookbook, /setFaceWaitSeconds\(Math\.floor\(\(Date\.now\(\) - startedAt\) \/ 1000\)\)/);
  assert.match(lookbook, /第 \$\{activeFaceIndex \+ 1\} 张，已等待 \$\{faceWaitSeconds\} 秒/);
});

test('a user-chosen face is not mistaken for a redo anchor', () => {
  const routeSource = fs.readFileSync('app/api/generate/stream/route.ts', 'utf8');
  const taskSource = fs.readFileSync('app/task/[id]/page.tsx', 'utf8');

  // 单张重做回传的锚会让服务端加上「贴合已通过组图」的口径，对新任务是错的
  assert.match(routeSource, /isRegeneration: requestHasSceneGroupAnchor && anchorIsUserChosen !== true/);
  assert.match(taskSource, /anchorIsUserChosen: freshProject\.modelFaceChosen === true/);
});
