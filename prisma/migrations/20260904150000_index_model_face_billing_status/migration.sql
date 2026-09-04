-- Speed up the supervisor refund sweep across unfinished billing states.
CREATE INDEX "ModelFaceGenerationItem_billingStatus_idx"
  ON "ModelFaceGenerationItem"("billingStatus");
