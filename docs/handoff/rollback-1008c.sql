-- 回滚 20261008200000_model_face_object_storage（模特脸图片迁到对象存储 R2）
--
-- 【顺序，缺一不可】
--   1. 若已经有行的图片只存在 R2 里（image 列为 NULL、imageKey 有值），必须先把图写回库：
--        DATABASE_URL=... OBJECT_STORAGE_...=... node scripts/model-face-storage-migrate.mjs --to-db --apply
--      （脚本逐行从 R2 取回、写回 image / thumbnail 并清空 key，写回后校验长度。）
--   2. 回滚应用代码到不依赖 imageKey / thumbnailKey 的旧版本（旧代码读 image 列，遇到 NULL 会报错）。
--   3. 执行本文件。下面的守卫块会在仍有 image 为空的行时直接报错并中止，不会丢数据。
--   4. 删除迁移记录，否则 prisma migrate deploy 会认为它已应用：
--        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008200000_model_face_object_storage';
--
-- 回滚的代价：imageKey / thumbnailKey 两列删除（桶里的对象不会被自动删除，需要的话另行清理）。

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ModelFace" WHERE "image" IS NULL) THEN
    RAISE EXCEPTION '仍有 ModelFace.image 为空的行（图片只在对象存储里）。请先运行 model-face-storage-migrate.mjs --to-db --apply 回迁，再重跑本文件';
  END IF;
END $$;

ALTER TABLE "ModelFace" ALTER COLUMN "image" SET NOT NULL;
ALTER TABLE "ModelFace" DROP COLUMN "thumbnailKey";
ALTER TABLE "ModelFace" DROP COLUMN "imageKey";

COMMIT;
