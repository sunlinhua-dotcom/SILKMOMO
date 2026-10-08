-- 回滚 20261008100000_auth_revocation_rate_limit
-- 【顺序】先回滚代码，再执行本文件：新代码在 proxy / 登录 / 注册 / AI 接口里读写这两张表
--          （表缺失时吊销检查会 fail-open、限流会退回内存，但登出接口写吊销表会报错并留日志），
--          所以必须先让线上跑回不依赖这两张表的旧版本，再 DROP。
-- 之后删除 _prisma_migrations 里这条迁移记录，否则 prisma migrate deploy 会认为它已应用：
--       DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261008100000_auth_revocation_rate_limit';
-- 回滚的代价：
--   - RevokedToken 里的数据丢失 = 回滚前已登出但还没过期（最长 7 天）的令牌会重新可用；
--   - RateLimitCounter 里的数据丢失 = 所有限流计数清零（只是放宽一次，无副作用）。
-- 两张表是本次迁移新建的，不含任何业务数据，也与其它表没有外键关联。

BEGIN;

DROP TABLE "RevokedToken";
DROP TABLE "RateLimitCounter";

COMMIT;
