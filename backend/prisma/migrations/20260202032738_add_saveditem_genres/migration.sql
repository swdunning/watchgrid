-- AlterTable
ALTER TABLE "SavedItem" ADD COLUMN     "genres" TEXT[] DEFAULT ARRAY[]::TEXT[];
