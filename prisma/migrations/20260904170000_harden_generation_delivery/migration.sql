ALTER TABLE "PendingImage"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'result',
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "PendingImage_idempotencyKey_key" ON "PendingImage"("idempotencyKey");
CREATE INDEX "PendingImage_kind_createdAt_idx" ON "PendingImage"("kind", "createdAt");
