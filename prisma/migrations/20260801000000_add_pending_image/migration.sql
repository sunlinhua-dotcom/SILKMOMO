-- CreateTable
CREATE TABLE "PendingImage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "shotIndex" INTEGER NOT NULL DEFAULT 0,
    "data" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingImage_userId_taskId_idx" ON "PendingImage"("userId", "taskId");

-- CreateIndex
CREATE INDEX "PendingImage_createdAt_idx" ON "PendingImage"("createdAt");
