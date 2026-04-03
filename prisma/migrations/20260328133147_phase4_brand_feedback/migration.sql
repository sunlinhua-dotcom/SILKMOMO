-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '默认品牌',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "defaultModelId" TEXT NOT NULL DEFAULT 'elena',
    "defaultBodyType" TEXT NOT NULL DEFAULT 'standard',
    "defaultSkinTone" TEXT NOT NULL DEFAULT 'light',
    "lightingStyle" TEXT NOT NULL DEFAULT 'soft_studio',
    "bgPreference" TEXT NOT NULL DEFAULT 'warm_cream',
    "colorPalette" TEXT NOT NULL DEFAULT '[]',
    "promptSuffix" TEXT NOT NULL DEFAULT '',
    "defaultModule" TEXT NOT NULL DEFAULT 'product',
    "defaultAspectRatio" TEXT NOT NULL DEFAULT '3:4',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL DEFAULT 'product',
    "shotIndex" INTEGER,
    "promptHash" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "modelId" TEXT,
    "bodyType" TEXT,
    "skinTone" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT '3:4',
    "apiModel" TEXT NOT NULL DEFAULT '',
    "success" BOOLEAN NOT NULL DEFAULT true,
    "apiLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "feedback" TEXT NOT NULL DEFAULT '',
    "feedbackTags" TEXT NOT NULL DEFAULT '[]',
    "downloaded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrandProfile_userId_idx" ON "BrandProfile"("userId");

-- CreateIndex
CREATE INDEX "GenerationRecord_userId_idx" ON "GenerationRecord"("userId");

-- CreateIndex
CREATE INDEX "GenerationRecord_promptHash_idx" ON "GenerationRecord"("promptHash");

-- CreateIndex
CREATE INDEX "GenerationRecord_rating_idx" ON "GenerationRecord"("rating");

-- CreateIndex
CREATE INDEX "GenerationRecord_module_shotIndex_idx" ON "GenerationRecord"("module", "shotIndex");

-- CreateIndex
CREATE INDEX "GenerationRecord_createdAt_idx" ON "GenerationRecord"("createdAt");
