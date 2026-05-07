-- AlterTable
ALTER TABLE "GenerationRecord" ADD COLUMN     "taskId" INTEGER;

-- CreateIndex
CREATE INDEX "GenerationRecord_taskId_idx" ON "GenerationRecord"("taskId");
