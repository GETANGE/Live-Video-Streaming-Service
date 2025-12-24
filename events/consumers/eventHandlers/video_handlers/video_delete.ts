import { prisma } from "@configs/database.config";
import { deleteVideo } from "@services/uploader.service";
import { VideoDeletePayload } from "@types";
import logger from "@utils/logger";


export const handleVideoDelete = async (
  payload: VideoDeletePayload,
): Promise<void> => {
  const { videoId, userId } = payload;

  try {
    logger.info(`🗑️ Deleting video: ${videoId}`);

    // Verify ownership before deletion
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { uploadedBy: true },
    });

    if (!video) {
      logger.warn(`Video ${videoId} not found, skipping deletion`);
      return;
    }

    if (video.uploadedBy !== userId) {
      logger.error(`User ${userId} not authorized to delete video ${videoId}`);
      throw new Error("Unauthorized deletion attempt");
    }

    // Delete from MinIO and CDN
    await deleteVideo(videoId);

    // Delete from database
    await prisma.video.delete({
      where: { id: videoId },
    });

    logger.info(`✅ Video deleted: ${videoId}`);
  } catch (error) {
    logger.error(`Failed to delete video ${videoId}:`, error);
    throw error;
  }
};
