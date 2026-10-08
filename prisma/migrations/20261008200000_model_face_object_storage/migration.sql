-- 模特脸图片迁出数据库：新增对象存储 key 两列，并放开 image 的 NOT NULL。
-- 只有 ADD COLUMN 与 DROP NOT NULL：对已有行零影响（旧行 image 仍有值、两个 key 为 NULL），
-- 未配置对象存储时应用行为与迁移前完全一致。回滚 SQL 见 docs/handoff/rollback-1008c.sql。

ALTER TABLE "ModelFace" ADD COLUMN "imageKey" TEXT;
ALTER TABLE "ModelFace" ADD COLUMN "thumbnailKey" TEXT;
ALTER TABLE "ModelFace" ALTER COLUMN "image" DROP NOT NULL;
