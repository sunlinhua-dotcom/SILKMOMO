-- 回滚 20261008000000_billing_fulfillment_and_indexes
-- 用法：先停应用（或确认新版本代码已回退——旧代码不认识 fulfilledAt，但留着该列无害），
--       再对目标库执行本文件；最后删除 _prisma_migrations 里这条迁移记录，否则 prisma migrate deploy 会认为它已应用：
--       DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008000000_billing_fulfillment_and_indexes';
-- 注意：回滚会丢失 fulfilledAt 数据。已上线运行过的版本，若要保留履约标记，只回滚索引部分（第 1、2 段）即可。

BEGIN;

-- 1. 恢复被删除的索引（定义与 0001_init / 20260507100510 / 20260904093000 一致）
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");
CREATE INDEX "GenerationRecord_promptHash_idx" ON "GenerationRecord"("promptHash");
CREATE INDEX "GenerationRecord_taskId_idx" ON "GenerationRecord"("taskId");
CREATE INDEX "ModelFaceGenerationJob_status_idx" ON "ModelFaceGenerationJob"("status");

-- 2. 删除本次新增的索引
DROP INDEX "Transaction_userId_createdAt_idx";
DROP INDEX "Transaction_type_createdAt_idx";
DROP INDEX "Transaction_type_fulfilledAt_createdAt_idx";
DROP INDEX "GenerationRecord_userId_taskId_createdAt_idx";
DROP INDEX "GenerationRecord_success_createdAt_idx";

-- 3. 删除新增列（回填数据随列丢弃）
ALTER TABLE "Transaction" DROP COLUMN "fulfilledAt";

COMMIT;
