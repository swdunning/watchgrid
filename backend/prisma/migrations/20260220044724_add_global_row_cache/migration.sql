-- CreateEnum
CREATE TYPE "GlobalRowStatus" AS ENUM ('OK', 'ERROR', 'RATE_LIMITED');

-- CreateTable
CREATE TABLE "GlobalRowCache" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'US',
    "itemsJson" TEXT NOT NULL,
    "status" "GlobalRowStatus" NOT NULL DEFAULT 'OK',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalRowCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalRowCache_key_key" ON "GlobalRowCache"("key");

-- CreateIndex
CREATE INDEX "GlobalRowCache_provider_kind_mode_idx" ON "GlobalRowCache"("provider", "kind", "mode");

-- CreateIndex
CREATE INDEX "GlobalRowCache_expiresAt_idx" ON "GlobalRowCache"("expiresAt");
