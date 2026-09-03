-- CreateTable
CREATE TABLE "ModelFaceGenerationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "activeKey" TEXT,
    "requestedCount" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startSpecIndex" INTEGER NOT NULL,
    "costFen" INTEGER NOT NULL,
    "runnerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ModelFaceGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelFaceGenerationItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "specIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "faceId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelFaceGenerationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelFaceGenerationJob_activeKey_key" ON "ModelFaceGenerationJob"("activeKey");
CREATE INDEX "ModelFaceGenerationJob_userId_createdAt_idx" ON "ModelFaceGenerationJob"("userId", "createdAt");
CREATE INDEX "ModelFaceGenerationJob_status_idx" ON "ModelFaceGenerationJob"("status");
CREATE UNIQUE INDEX "ModelFaceGenerationItem_faceId_key" ON "ModelFaceGenerationItem"("faceId");
CREATE UNIQUE INDEX "ModelFaceGenerationItem_jobId_position_key" ON "ModelFaceGenerationItem"("jobId", "position");
CREATE INDEX "ModelFaceGenerationItem_jobId_status_idx" ON "ModelFaceGenerationItem"("jobId", "status");
CREATE INDEX "ModelFaceGenerationItem_createdAt_idx" ON "ModelFaceGenerationItem"("createdAt");

-- AddForeignKey
ALTER TABLE "ModelFaceGenerationJob" ADD CONSTRAINT "ModelFaceGenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelFaceGenerationItem" ADD CONSTRAINT "ModelFaceGenerationItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ModelFaceGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelFaceGenerationItem" ADD CONSTRAINT "ModelFaceGenerationItem_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "ModelFace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
