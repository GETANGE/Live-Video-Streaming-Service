import cron, { ScheduledTask } from "node-cron";
import { prisma } from "@configs/database.config";
import { streamFromMinio } from "@helpers/hls.helper-functions";
import { uploadImage, isCloudinaryConfigured } from "@services/cdn.service";
import { getCDNCacheKeys } from "@helpers/cacheInvalidations/cdnCacheInvalidation";
import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

// Cron task reference
let cronTask: ScheduledTask | null = null;

// Configuration
const CRON_SCHEDULE = process.env.CDN_SYNC_CRON || "*/1 * * * *";
const BATCH_SIZE = parseInt(process.env.CDN_SYNC_BATCH_SIZE || "10", 10);
const MAX_SYNC_ATTEMPTS = parseInt(process.env.CDN_MAX_SYNC_ATTEMPTS || "3", 10);

interface SyncResult {
  synced: number;
  failed: number;
  skipped: number;
}

// Sync a single video's thumbnail to CDN
const syncThumbnailToCDN = async (
  videoId: string,
  thumbnailPath: string,
): Promise<{ cdnUrl: string; publicId: string } | null> => {
  try {
    const stream = await streamFromMinio(thumbnailPath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const result = await uploadImage(buffer, "thumbnails", videoId);
    return { cdnUrl: result.url, publicId: result.publicId };
  } catch (error) {
    logger.error(`Failed to sync thumbnail for video ${videoId}:`, error);
    return null;
  }
};

// Main sync function
export const syncPendingToCDN = async (): Promise<SyncResult> => {
  const result: SyncResult = { synced: 0, failed: 0, skipped: 0 };

  try {
    // Query unsynced videos that haven't exceeded max attempts
    const unsyncedVideos = await prisma.video.findMany({
      where: {
        thumbnailUrl: { not: null },
        cdnSynced: false,
        cdnSyncAttempts: { lt: MAX_SYNC_ATTEMPTS },
      },
      take: BATCH_SIZE,
      orderBy: [
        { cdnSyncAttempts: "asc" }, // Prioritize videos with fewer attempts
        { createdAt: "asc" },
      ],
      select: {
        id: true,
        cdnSyncAttempts: true,
      },
    });

    if (unsyncedVideos.length === 0) {
      return result;
    }

    logger.info(`☁️ CDN sync: Processing ${unsyncedVideos.length} videos`);

    for (const video of unsyncedVideos) {
      const cdnResult = await syncThumbnailToCDN(
        video.id,
        `thumbnails/${video.id}.jpg`,
      );

      if (cdnResult) {
        // Mark as synced in DB
        await prisma.video.update({
          where: { id: video.id },
          data: {
            cdnUrl: cdnResult.cdnUrl,
            publicId: cdnResult.publicId,
            cdnSynced: true,
            cdnSyncedAt: new Date(),
          },
        });

        // Populate Redis cache so getContentUrl() serves CDN URL immediately
        const cacheKeys = await getCDNCacheKeys();
        await redisClient.setex(cacheKeys.thumbnail(video.id), 3600, cdnResult.cdnUrl);

        result.synced++;
      } else {
        // Increment attempt counter
        const newAttempts = video.cdnSyncAttempts + 1;
        await prisma.video.update({
          where: { id: video.id },
          data: { cdnSyncAttempts: newAttempts },
        });

        if (newAttempts >= MAX_SYNC_ATTEMPTS) {
          logger.warn(`Video ${video.id} exceeded max sync attempts (${MAX_SYNC_ATTEMPTS})`);
          result.skipped++;
        } else {
          result.failed++;
        }
      }
    }

    logger.info(
      `☁️ CDN sync complete: ${result.synced} synced, ${result.failed} failed, ${result.skipped} skipped`,
    );
  } catch (error) {
    logger.error("CDN sync job error:", error);
  }

  return result;
};

// Reset failed sync attempts (for manual retry)
export const resetSyncAttempts = async (videoId?: string): Promise<number> => {
  const result = await prisma.video.updateMany({
    where: videoId
      ? { id: videoId, cdnSynced: false }
      : { cdnSynced: false, cdnSyncAttempts: { gte: MAX_SYNC_ATTEMPTS } },
    data: { cdnSyncAttempts: 0 },
  });
  logger.info(`Reset sync attempts for ${result.count} videos`);
  return result.count;
};


// Start the CDN sync cron job
export const startCDNSyncJob = (): void => {
  if (!isCloudinaryConfigured()) {
    logger.warn("CDN sync job not started - Cloudinary not configured");
    return;
  }

  // Run immediately on start
  syncPendingToCDN();

  // Schedule recurring job
  cronTask = cron.schedule(CRON_SCHEDULE, syncPendingToCDN);

  logger.info(`▶️ CDN sync job started (schedule: ${CRON_SCHEDULE}, batch: ${BATCH_SIZE}, max attempts: ${MAX_SYNC_ATTEMPTS})`);
};

// Stop the CDN sync job
export const stopCDNSyncJob = (): void => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info("CDN sync job stopped");
  }
};
