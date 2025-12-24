import { prisma } from "@configs/database.config";
import { VideoProcessPayload } from "@types";
import { processVideoFromStorage } from "@services/uploader.service";
import logger from "@utils/logger";


export const handleVideoProcess = async (
  payload: VideoProcessPayload,
): Promise<void> => {
  const { videoId, userId, channelId, title, description, fileName } = payload;

  try {
    logger.info(`🎬 Starting video processing: ${videoId}`);

    // Process video with FFmpeg and upload HLS to MinIO
    const result = await processVideoFromStorage(videoId, fileName);

    // Save to database
    await prisma.video.create({
      data: {
        id: videoId,
        title,
        description,
        duration: result.duration,
        uploadedBy: userId,
        channelId,
        originalUrl: result.originalUrl,
        thumbnailUrl: result.thumbnailUrl,
        streamingUrl: result.streamingUrl,
      },
    });

    logger.info(`✅ Video processed and saved: ${videoId}`);
  } catch (error) {
    logger.error(`Failed to process video ${videoId}:`, error);
    throw error;
  }
};
