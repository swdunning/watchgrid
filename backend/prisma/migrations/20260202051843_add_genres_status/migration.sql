-- CreateEnum
CREATE TYPE "GenresStatus" AS ENUM ('PENDING', 'OK', 'NONE', 'ERROR');

-- AlterTable
ALTER TABLE "SavedItem" ADD COLUMN     "genresAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "genresStatus" "GenresStatus" NOT NULL DEFAULT 'PENDING';
