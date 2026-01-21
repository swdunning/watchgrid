/*
  Warnings:

  - Changed the type of `provider` on the `SavedItem` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `provider` on the `UserProvider` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "SavedItem" DROP COLUMN "provider",
ADD COLUMN     "provider" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "UserProvider" DROP COLUMN "provider",
ADD COLUMN     "provider" TEXT NOT NULL;

-- DropEnum
DROP TYPE "ProviderKey";

-- CreateIndex
CREATE UNIQUE INDEX "SavedItem_userId_provider_watchmodeTitleId_key" ON "SavedItem"("userId", "provider", "watchmodeTitleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProvider_userId_provider_key" ON "UserProvider"("userId", "provider");
