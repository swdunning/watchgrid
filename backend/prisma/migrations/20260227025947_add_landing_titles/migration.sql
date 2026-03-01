-- CreateTable
CREATE TABLE "LandingTitle" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "posterUrl" TEXT NOT NULL,
    "provider" TEXT,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LandingTitle_createdAt_idx" ON "LandingTitle"("createdAt");
