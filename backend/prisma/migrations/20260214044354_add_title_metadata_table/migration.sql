-- CreateEnum
CREATE TYPE "TitleMetaStatus" AS ENUM ('PENDING', 'OK', 'ERROR');

-- CreateTable
CREATE TABLE "Title" (
    "watchmodeTitleId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "poster" TEXT,
    "year" INTEGER,
    "runtimeMinutes" INTEGER,
    "seasons" INTEGER,
    "description" TEXT,
    "metaStatus" "TitleMetaStatus" NOT NULL DEFAULT 'PENDING',
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("watchmodeTitleId")
);

-- CreateIndex
CREATE INDEX "Title_metaStatus_idx" ON "Title"("metaStatus");
CREATE INDEX "Title_lastFetchedAt_idx" ON "Title"("lastFetchedAt");

-- ✅ Backfill Title rows from existing SavedItem rows so the FK can be added safely
INSERT INTO "Title" ("watchmodeTitleId", "title", "type", "poster", "createdAt", "updatedAt")
SELECT DISTINCT
  s."watchmodeTitleId",
  s."title",
  s."type",
  s."poster",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "SavedItem" s
ON CONFLICT ("watchmodeTitleId") DO NOTHING;

-- AddForeignKey
ALTER TABLE "SavedItem"
ADD CONSTRAINT "SavedItem_watchmodeTitleId_fkey"
FOREIGN KEY ("watchmodeTitleId") REFERENCES "Title"("watchmodeTitleId")
ON DELETE RESTRICT ON UPDATE CASCADE;
