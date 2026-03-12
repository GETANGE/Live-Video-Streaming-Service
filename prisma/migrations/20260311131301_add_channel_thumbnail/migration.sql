-- AlterEnum
ALTER TYPE "ModerationAction" ADD VALUE 'UNBAN';

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "thumbnailUrl" TEXT;
