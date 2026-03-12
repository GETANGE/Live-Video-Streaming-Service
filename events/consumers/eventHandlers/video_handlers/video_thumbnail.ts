import { prisma } from "@configs/database.config";
import { uploadThumbnail } from "@services/uploader.service";
import { syncThumbnailToCDN } from "@services/cdn.service";
import { VideoThumbnailPayload } from "@types";
import logger from "@utils/logger";


export const handleVideoThumbnail = async (
  payload: VideoThumbnailPayload,
): Promise<void> => {
  const { videoId, userId, buffer } = payload;

  try {
    logger.info(`🖼️ Processing thumbnail for video: ${videoId}`);

    // Verify ownership before updating thumbnail
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { uploadedBy: true },
    });

    if (!video) {
      logger.warn(`Video ${videoId} not found, skipping thumbnail update`);
      return;
    }

    if (video.uploadedBy !== userId) {
      logger.error(`User ${userId} not authorized to update thumbnail for video ${videoId}`);
      throw new Error("Unauthorized thumbnail update attempt");
    }

    // Decode base64 buffer
    const imageBuffer = Buffer.from(buffer, "base64");

    // Upload thumbnail to MinIO
    const result = await uploadThumbnail(imageBuffer, videoId);

    // Sync to Cloudinary CDN (non-blocking, best-effort)
    const cdnResult = await syncThumbnailToCDN(videoId, imageBuffer).catch((err) => {
      logger.warn(`CDN thumbnail sync failed for ${videoId}:`, err);
      return null;
    });

    // Update video record with thumbnail URL and CDN info
    await prisma.video.update({
      where: { id: videoId },
      data: {
        thumbnailUrl: result.url,
        // Update CDN fields if sync succeeded
        ...(cdnResult && {
          cdnUrl: cdnResult.cdnUrl,
          publicId: cdnResult.publicId,
          cdnSynced: true,
          cdnSyncedAt: new Date(),
        }),
        // Reset sync tracking if CDN sync failed (background job will retry)
        ...(!cdnResult && {
          cdnSynced: false,
          cdnSyncAttempts: 0,
        }),
      },
    });

    logger.info(`✅ Thumbnail uploaded for video: ${videoId}`);
  } catch (error) {
    logger.error(`Failed to process thumbnail for ${videoId}:`, error);
    throw error;
  }
};
