-- CreateTable
CREATE TABLE "ModelFace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "specIndex" INTEGER NOT NULL,
    "recipeLabel" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelFace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelFace_userId_favorite_createdAt_idx" ON "ModelFace"("userId", "favorite", "createdAt");

-- AddForeignKey
ALTER TABLE "ModelFace" ADD CONSTRAINT "ModelFace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
