-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "cdnSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cdnSynced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cdnSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Video_cdnSynced_cdnSyncAttempts_idx" ON "Video"("cdnSynced", "cdnSyncAttempts");
