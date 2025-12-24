/*
  Warnings:

  - You are about to drop the column `mongoManifestId` on the `Video` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Video_title_description_idx";

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "mongoManifestId",
ADD COLUMN     "cdnUrl" TEXT,
ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "originalUrl" TEXT,
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "streamingUrl" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT,
ALTER COLUMN "duration" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "Video_channelId_idx" ON "Video"("channelId");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
