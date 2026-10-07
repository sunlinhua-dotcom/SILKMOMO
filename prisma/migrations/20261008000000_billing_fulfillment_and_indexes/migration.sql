-- 计费履约标记 + 索引整理（纯增量列 + 新增索引 + 删除冗余索引，均可回滚，回滚 SQL 见 docs/handoff/rollback-1008.sql）

-- 1. Transaction.fulfilledAt：出图类 consume 的履约时间（结果已写入 pending / 已推给客户端）
ALTER TABLE "Transaction" ADD COLUMN "fulfilledAt" TIMESTAMP(3);

-- 2. 回填（致命坑）：迁移前的历史 consume 全部视为已履约。
--    不回填的话，上线后孤儿清扫会把全部历史消费当成「已扣费未出图」再退一遍。
--    type 的真实取值（见 prisma/schema.prisma 注释）："recharge" | "consume" | "refund" | "bonus"。
UPDATE "Transaction" SET "fulfilledAt" = "createdAt" WHERE "type" = 'consume';

-- 3. Transaction 索引：加两个联合索引 + 清扫索引，删被 [userId, createdAt] 前缀覆盖的 [userId]
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");
CREATE INDEX "Transaction_type_createdAt_idx" ON "Transaction"("type", "createdAt");
CREATE INDEX "Transaction_type_fulfilledAt_createdAt_idx" ON "Transaction"("type", "fulfilledAt", "createdAt");
DROP INDEX "Transaction_userId_idx";

-- 4. GenerationRecord 索引：加联合索引，删 promptHash / taskId 单列索引
--    （rating 单列索引保留：lib/generation-record.ts getQualityAnalytics 有 where rating 查询依赖）
CREATE INDEX "GenerationRecord_userId_taskId_createdAt_idx" ON "GenerationRecord"("userId", "taskId", "createdAt");
CREATE INDEX "GenerationRecord_success_createdAt_idx" ON "GenerationRecord"("success", "createdAt");
DROP INDEX "GenerationRecord_promptHash_idx";
DROP INDEX "GenerationRecord_taskId_idx";

-- 5. ModelFaceGenerationJob：[status] 是 [status, leaseUntil] 的前缀
DROP INDEX "ModelFaceGenerationJob_status_idx";
