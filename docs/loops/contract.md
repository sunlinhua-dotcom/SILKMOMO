# 组图·换装 验收 contract（对抗评审协商产出）

> passRate: 34/34 · overall 0.92 · verdict: 达到 done

- [FUND-01][critical] **funds** — 组图 N 循环中每张在实际调 generateBackendImage 之前先 checkBalance 再 deductBalance('组图换装 #refSeq')，即扣费严格早于调图；扣费失败(deduction.success===false)时不调图、push fatal error、failedCount += total-i 并 break。
  验：读 app/api/generate/stream/route.ts 522-550：确认顺序 checkBalance(522)→deductBalance(537)→try{generateBackendImage}(565)；确认 deduction 失败分支(538-550)在 generateBackendImage 之前 break，且未产生图。
- [FUND-02][critical] **funds** — 钱扣后三条失败路径都退款且金额=PRICING.pricePerCallFen：generateBackendImage 抛异常(catch innerErr)、result.success===false、result.success 但 clientClosed(已出图客户端已断)，三处均 refundBalance(PRICING.pricePerCallFen,...)。
  验：读 stream/route.ts：577(异常退款)、615(失败退款)、606(断开退款)三处 refundBalance 均传 PRICING.pricePerCallFen。分别 mock 三类失败各一次，断言每次 balance 净变化=0(扣一退一)、交易流水成对。
- [FUND-03][critical] **funds** — 退款调用自身抛错时不会静默吞掉、不会连累后续张：refundBalance 若 reject，异常 catch 块(577)内的退款失败必须被日志记录且不中断循环剩余张。
  验：读 stream/route.ts 577/606/615——当前三处 refundBalance 均为裸 await 无 .catch/try 包裹(对比 recordGeneration 的 .catch(err=>console.error))。构造 refundBalance mock 抛错：断言 (a)有 console.error 日志 (b)后续 targetIndexes 仍继续。若两者任一不成立=FAIL(违反 CLAUDE.md「退款失败留日志」硬约束)。
- [FUND-04][high] **funds** — 余额不足优雅停机不产生资金悬置：循环内 checkBalance 不足时，仅对未开始的张记 failedCount += total-i 并 break，已 break 的剩余张从未 deductBalance 故无需退款(净扣费=已成功张数×单价)。
  验：读 stream/route.ts 522-535。构造第 3 张时余额不足：断言前 2 张各扣 1 笔、第 3+张 0 扣费 0 退款、failedCount 含剩余全部、无 refundBalance 调用。
- [FUND-05][high] **funds** — 前端成本单价与后端计费单价一致：LOOKBOOK 页 PRICE_PER_IMAGE_FEN 必须等于 PRICING.pricePerCallFen，否则「余额不足」门控与「¥X」展示与真实扣费不符。
  验：app/lookbook/page.tsx:22 PRICE_PER_IMAGE_FEN=65；lib/billing-constants.ts:18 pricePerCallFen=65——当前相等但为重复硬编码常量(无引用关系)。断言两值相等；标记为漂移风险(改一处不改另一处即回归)。
- [FUND-06][high] **funds** — 自动识别扣费失败/上游失败不让用户为失败调用买单：/api/ai/analyze 组图分支 deductCustom 失败或 analyzeLookbookGroup 返回 ok:false 时退款(refundBalance aiAnalysisPricePerCallFen)或不扣费返回 billingSkipped。
  验：读 app/api/ai/analyze/route.ts 48-62：deduction 失败→直接返回 billingSkipped 不进一步扣；groupResult.ok===false→refundBalance(60)。mock analyzeLookbookGroup 失败一次，断言该次分析净扣费=0。
- [BCORR-01][high] **b-correctness** — 每张走 GPT edit 冻结底图：sceneAsEditBase:true 且 sceneRefImages:[baseRef]（baseRef=sceneRefImages[refSeq-1]，即当前那张 lookbook 作编辑底图），只换服装不重绘场景。
  验：读 stream/route.ts 511-573：baseRef=sceneRefImages[refSeq-1]；generateBackendImage 入参 sceneRefImages:[baseRef] + sceneAsEditBase:true。真机抽样：输出背景/构图/姿势与对应 lookbook 一致，仅服装+人物身份变。
- [BCORR-02][high] **b-correctness** — N 张换装图为同一个全新模特：首批无锚时首张成功图充当 anchorImage 供后续 N-1 张；重做/补齐时客户端带已有一张 type==='result' 结果图作 sceneGroupAnchor。
  验：读 stream/route.ts 500-504(锚入参)、611(首张自锚)；app/task/[id]/page.tsx 303-311(补齐取 doneSiblings[0] 作 groupAnchor)。真机：N 张同一张脸/同一身份、姿势各随底图；补齐的图与首批同人。
- [BCORR-03][high] **b-correctness** — 后端提示只点名真上传的品类：buildSceneGroupPrompt 用 sceneGroupGarmentCategories(映射 GARMENT_CATEGORY_EN)明确换哪几件，不点名未上传的品类。
  验：读 lib/api.ts 317-330 buildSceneGroupPrompt 的 cats 构造；app/lookbook/page.tsx 144-146 sceneGroupCategories 仅序列化 length>0 的品类。传 top+pants 两类：断言 prompt 含 top/pants 英文、不含 dress/skirt 等未上传品类。
- [BCORR-04][high] **b-correctness** — 落库映射正确：主品→type='product'、lookbook→type='scene_ref'、附件→type='accessory'；project 记 moduleType='scene'、sceneGroup:true、sceneHasModel:true、engine、sceneOutputSize、sceneGroupCategories(仅有图品类 JSON)。
  验：读 app/lookbook/page.tsx 131-161。生成后查 SilkMomoDB：三类 image type 计数 = 各自上传数；project 字段齐全；sceneGroupCategories 解析后不含空品类。
- [BCORR-05][medium] **b-correctness** — 自动识别去重不重复扣费：指纹 sigOf=`长度:首图base64长:尾图base64长`，指纹未变(重渲染/无改动)不再请求 analyze；改图指纹变则重跑。
  验：读 app/lookbook/page.tsx 61-103：useEffect 中 sigOf===lastSigRef 时 return；指纹只在成功落地后写(82)。无变更重渲染断言不产生第二次 /api/ai/analyze 请求。
- [NN-01][critical] **contract-spec** — N 进 N 出：上传 N 张 lookbook 全量生成 N 张。后端 N=sceneRefImages.length、targetIndexes 默认 1..N、total=targetIndexes.length；前端 CTA/摘要显示「将生成 N 张」；getShotCount 用 sceneRefs 张数。
  验：读 stream/route.ts 473-485；app/lookbook/page.tsx 280/305；app/task/[id]/page.tsx 867-870 getShotCount。传 4 张全量：断言 4 个 result 事件、shotIndex 覆盖 1..4。
- [NN-02][high] **contract-spec** — shotIndex 语义=1-based 参考图序号 refSeq(非镜次)；任务页对组图不按镜次查 shotConfig(shotConfig 仅 moduleType==='product' 时查)。
  验：读 stream/route.ts 511/518/612(shotIndex=refSeq)；app/task/[id]/page.tsx 493(shotConfig 仅 product 分支)。断言组图 result 的 shotIndex∈[1,N] 且不带 frameType/angle。
- [NN-03][high] **b-correctness** — 逐张独立：某张 result.success===false 或 generateBackendImage 抛异常时 continue，不整批中止；余下张继续生成。
  验：读 stream/route.ts 587(异常 continue)、621(失败不 break)。mock 第 2 张失败：断言第 1/3/4 张仍出图、failedCount=1、successCount=3。
- [SPEC-01][high] **contract-spec** — 两个独立入口不互相污染：/ 渲染 app/page.tsx(产品图)、/lookbook 渲染 LookbookStudio；lookbookImages/groupGarments/accessoryImages 均为 LookbookStudio 内部 state，A/B 输入区互不残留。
  验：读 app/lookbook/page.tsx 39-49(全部本地 useState)。静态 mock：B 上传图后切到 A(反之)，对方输入区为空。
- [SPEC-02][high] **contract-spec** — 存储键/展示名零改动：silkmomo_*/SilkMomoDB/cookie 键名未被本功能改名(CLAUDE.md 硬约束)；顶栏展示名为 SILXINE。
  验：grep -rE 'SilkMomoDB|silkmomo_' 确认无新增变体键名；app/lookbook/page.tsx:194 顶栏文案='SILXINE'。
- [SPEC-03][high] **contract-spec** — 换装 N 进 N 出的单张重做/补齐组图化：redo/补齐走 sceneGroupTargetIndexes 只跑指定序号，不重跑全批；补齐目标=缺失的 1..N 序号。
  验：读 app/task/[id]/page.tsx 224-232(补齐算 remaining 缺失序号)、288(groupTargetIndexes=override)、773-777(redo 单序号)；stream/route.ts 475-478(target 过滤到 [1,N])。补齐 2 张缺失：断言只请求这 2 个 shotIndex。
- [AREG-01][high] **a-regression** — A 产品图任务硬门控不被连累：handleStartGeneration 与两个触发点在 products.length===0 时提前 return，无产品图不生成。
  验：读 app/task/[id]/page.tsx 201/211/255/278：四处 inputImages.products.length===0 / freshInputs.products.length===0 门控。构造 products=[] 任务：断言 SSE 未发起、无扣费。
- [AREG-02][high] **a-regression** — A 产品图仍按镜次查 shotConfig：moduleType==='product' 分支正常产出 frameType/shootingAngle/imageType；组图分支不触碰该逻辑。
  验：读 app/task/[id]/page.tsx 493-531：shotConfig 仅 product；resultHasModel 组图取 project.sceneHasModel、产品取 shotConfig.hasModel。跑一个产品图任务断言 frameType/angle 非空。
- [AREG-03][high] **a-regression** — 全绿基线：tsc / eslint / build 三者全过，作为提交门槛。
  验：运行 npx tsc --noEmit、npx eslint .、next build，三者退出码 0。
- [EDGE-01][high] **edge-case** — 0 张 lookbook：前端 canGenerate=false(lookbookOk 需 length>=1)且提示「先上传 lookbook」；即便绕过到后端，sceneRefImages 为空时 push fatal「场景图模块需要上传场景参考图」不扣费。
  验：读 app/lookbook/page.tsx 115-117/311；stream/route.ts 448-459。构造空 lookbook 提交：断言前端 CTA 禁用、后端 fatal 且 0 扣费。
- [EDGE-02][high] **edge-case** — 超 20 张 lookbook：前端 ImageUploader maxFiles=20 挡第 21 张 + 超限提示；即便绕过，后端 validateImageInputs 对 sceneRefImages max=20 硬拒(400/前置 error)。
  验：读 app/lookbook/page.tsx 21/233/238-240；stream/route.ts 70-86(sceneRefImages max:20)。构造 21 张请求体直打后端：断言被 validateImageInputs 拒绝。
- [EDGE-03][high] **edge-case** — 主品图合计超 8 张：前端 MAX_TOTAL_GARMENTS=8 跨所有品类合计计数并挡，超限时 canGenerate=false;后端 productImages max=8 硬拒。
  验：读 app/lookbook/page.tsx 116/311；components/LookbookGarmentSlots.tsx MAX_TOTAL_GARMENTS 定义与合计计数；stream/route.ts 71(productImages max:8)。多品类累加到 9 张：断言前端挡、后端拒。
- [EDGE-04][high] **edge-case** — 识别为空(primaryCategories=[])：LookbookGarmentSlots 兜底出一个「通用槽」(other)，不留空白无法上传；用户可在通用槽上传服装继续生成。
  验：读 components/LookbookGarmentSlots.tsx 的 CATEGORY_ORDER 去重与 other 兜底分支。mock analyze 返回 {primaryCategories:[],accessories:[]}：断言渲染出通用槽且可上传。
- [EDGE-05][high] **edge-case** — 识别失败降级路径与生成端初稿 B3 不符——须按真实实现验收：analyze 在 AI 失败/未配置/groupResult.ok===false 时返回 HTTP 200 + billingSkipped(非 non-200)，前端仅在 !res.ok 或 throw 时才显示 error 文案与「重新识别」；故普通 AI 失败会表现为 done:true + 空品类 + 无 error 横幅。须确认此时用户仍能经通用槽兜底完成生成，且『重新识别』按钮在需要时可用。
  验：读 app/api/ai/analyze/route.ts 44-62(三处 200+billingSkipped)对比 app/lookbook/page.tsx 75-91(仅 !res.ok/throw 触发 error)。mock 网络层 500→断言出现 error 文案+重新识别；mock analyzeLookbookGroup 内部失败(200 空结果)→断言退化为通用槽兜底(EDGE-04)，据此判定 B3 原文『返回非 200 触发降级』为 FAIL 需修文档或代码。
- [EDGE-06][medium] **edge-case** — 识别只抽样前 8 张：analyze 组图分支 MAX_GROUP_IMAGES=8，上传 20 张 lookbook 时仅前 8 张参与品类识别；须确认这不导致漏识别关键品类到无兜底(仍有 other 通用槽)。
  验：读 app/api/ai/analyze/route.ts 13/38(.slice(0,8))。传 20 张其中主品出现在第 10 张：断言识别可能漏该品类，但通用槽兜底保证仍可上传(EDGE-04)。
- [EDGE-07][high] **edge-case** — 识别在途改图竞态守卫：快速连改 lookbook 时 seqRef 守卫使旧 analyze 响应被丢弃(seq!==seqRef.current 时 return)，不覆盖新识别；onLookbookChange 同时 seqRef++ 使在途响应失效并重置 groupAnalysis。
  验：读 app/lookbook/page.tsx 66/74/80/89(seq 守卫)、106-112(onLookbookChange 递增 seq+重置)。模拟先发慢响应 seq=1 后改图 seq=2：断言 seq=1 响应到达时被丢弃。
- [EDGE-08][high] **edge-case** — 单张重做补齐 anchor：重做/补齐(指定 groupTargetIndexes)时按 type==='result' 且 shotIndex∉targetIndexes 取 doneSiblings[0] 作 sceneGroupAnchor，使补的图与首批同一新人;正在重做的那张已被降级为 result_backup 故被自然排除。
  验：读 app/task/[id]/page.tsx 303-311(anchor 选取)、768(重做前 update 为 result_backup)。补齐场景:已有 result 且 target=缺失序号→断言请求带 sceneGroupAnchor=某已完成结果图 data。
- [EDGE-09][high] **edge-case** — 客户端断开(clientClosed):循环入口 clientClosed 时 break 提前终止;已出图但断开(result.success && data && clientClosed)时退款+failedCount++且 recordGeneration success=false(errorMessage='client disconnected before delivery'),不计交付成功、无重复退款。
  验：读 stream/route.ts 507-509(入口 break)、591/597-602(deliveredButDisconnected 记 false)、604-609(断开退款+break)。断言异常退款(577)与断开退款(606)互斥不双退。
- [EDGE-10][medium] **edge-case** — 目标序号非法:sceneGroupTargetIndexes 过滤到 [1,N] 整数后为空时 push fatal「组图参考图序号非法」并 return,不进循环、不扣费。
  验：读 stream/route.ts 475-484。构造 targetIndexes=[0,99] (N=4):断言 filter 后为空→fatal→0 扣费。
- [EDGE-11][high] **edge-case** — 余额不足(前端):currentUser.balanceFen < totalCostFen 时 CTA 变「余额不足(差 ¥X)·去充值」并链到 /billing,handleGenerate 直接 return 不落库不跳转。
  验：读 app/lookbook/page.tsx 119-127/283-301。构造 balanceFen<totalCostFen:断言 CTA 文案+diffYuan 正确、点击不进入生成。
- [UX-01][medium] **ux** — 识别中显示骨架占位(非确定性进度),识别未完成不显示品类槽,避免 layout shift;识别到品类按 CATEGORY_ORDER 固定顺序去重长槽。
  验：读 components/LookbookGarmentSlots.tsx 的 loading 骨架分支与 CATEGORY_ORDER 排序去重;app/lookbook/page.tsx 244-257 传 groupAnalysis.loading。mock loading:true→断言显示骨架非空槽。
- [UX-02][low] **ux** — 双工作台切换器:/lookbook 上 WorkspaceSwitcher active='lookbook' 高亮 lookbook 卡,可互跳到 / (产品图);未登录 B 页给「请先登录」兜底+去登录链接。
  验：读 app/lookbook/page.tsx 211(active='lookbook')、171-181(未登录兜底)。断言高亮卡为 lookbook、未登录时渲染登录兜底而非工作区。
- [UX-03][low] **ux** — 摘要文案实时准确:显示「识别到 N 件·已上传 M 类主品·将生成 K 张」,其中 K=lookbookImages.length、M=有图品类数、识别件数仅在 done 且>0 时显示。
  验：读 app/lookbook/page.tsx 278-281/122。构造已识别2件+已传1类+3张lookbook:断言文案数字与实际输入一致。
