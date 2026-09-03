-- Persist compact previews and idempotent ledger event keys.
ALTER TABLE "ModelFace" ADD COLUMN "thumbnail" TEXT;
ALTER TABLE "ModelFace" ALTER COLUMN "mimeType" SET DEFAULT 'image/jpeg';
ALTER TABLE "Transaction" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- Use database enums for the stable worker state machines.
CREATE TYPE "ModelFaceJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE "ModelFaceItemStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');
CREATE TYPE "ModelFaceBillingStatus" AS ENUM ('uncharged', 'charged', 'refund_pending', 'refunded', 'kept');

ALTER TABLE "ModelFaceGenerationJob"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ModelFaceJobStatus" USING ("status"::text::"ModelFaceJobStatus"),
  ALTER COLUMN "status" SET DEFAULT 'queued',
  ADD COLUMN "leaseUntil" TIMESTAMP(3);

ALTER TABLE "ModelFaceGenerationItem"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ModelFaceItemStatus" USING ("status"::text::"ModelFaceItemStatus"),
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ADD COLUMN "billingKey" TEXT,
  ADD COLUMN "billingStatus" "ModelFaceBillingStatus" NOT NULL DEFAULT 'uncharged',
  ADD COLUMN "attemptedAt" TIMESTAMP(3);

-- Existing rows use their already-unique item id as the stable billing key.
UPDATE "ModelFaceGenerationItem" SET "billingKey" = "id" WHERE "billingKey" IS NULL;
UPDATE "ModelFaceGenerationItem"
SET "billingStatus" = CASE
  WHEN "status" = 'succeeded' THEN 'kept'::"ModelFaceBillingStatus"
  WHEN "status" = 'running' THEN 'charged'::"ModelFaceBillingStatus"
  WHEN "status" = 'failed' AND COALESCE("error", '') LIKE '%退款失败%' THEN 'refund_pending'::"ModelFaceBillingStatus"
  WHEN "status" = 'failed' THEN 'refunded'::"ModelFaceBillingStatus"
  ELSE 'uncharged'::"ModelFaceBillingStatus"
END;
ALTER TABLE "ModelFaceGenerationItem" ALTER COLUMN "billingKey" SET NOT NULL;

CREATE UNIQUE INDEX "ModelFaceGenerationItem_billingKey_key" ON "ModelFaceGenerationItem"("billingKey");
CREATE INDEX "ModelFaceGenerationJob_status_leaseUntil_idx" ON "ModelFaceGenerationJob"("status", "leaseUntil");
CREATE INDEX "ModelFaceGenerationItem_attemptedAt_idx" ON "ModelFaceGenerationItem"("attemptedAt");

-- Defensive invariants for prices, counters, and the fixed ten-recipe / three-item batch.
ALTER TABLE "ModelFace" ADD CONSTRAINT "ModelFace_specIndex_check"
  CHECK ("specIndex" >= 0 AND "specIndex" < 10);
ALTER TABLE "ModelFaceGenerationJob" ADD CONSTRAINT "ModelFaceGenerationJob_requestedCount_check"
  CHECK ("requestedCount" = 3);
ALTER TABLE "ModelFaceGenerationJob" ADD CONSTRAINT "ModelFaceGenerationJob_completedCount_check"
  CHECK ("completedCount" >= 0 AND "completedCount" <= "requestedCount");
ALTER TABLE "ModelFaceGenerationJob" ADD CONSTRAINT "ModelFaceGenerationJob_failedCount_check"
  CHECK ("failedCount" >= 0 AND "failedCount" <= "requestedCount");
ALTER TABLE "ModelFaceGenerationJob" ADD CONSTRAINT "ModelFaceGenerationJob_totalCount_check"
  CHECK ("completedCount" + "failedCount" <= "requestedCount");
ALTER TABLE "ModelFaceGenerationJob" ADD CONSTRAINT "ModelFaceGenerationJob_startSpecIndex_check"
  CHECK ("startSpecIndex" >= 0 AND "startSpecIndex" < 10);
ALTER TABLE "ModelFaceGenerationJob" ADD CONSTRAINT "ModelFaceGenerationJob_costFen_check"
  CHECK ("costFen" > 0);
ALTER TABLE "ModelFaceGenerationItem" ADD CONSTRAINT "ModelFaceGenerationItem_position_check"
  CHECK ("position" >= 0 AND "position" < 3);
ALTER TABLE "ModelFaceGenerationItem" ADD CONSTRAINT "ModelFaceGenerationItem_specIndex_check"
  CHECK ("specIndex" >= 0 AND "specIndex" < 10);
