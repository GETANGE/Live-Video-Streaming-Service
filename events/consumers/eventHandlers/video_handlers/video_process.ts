import { prisma } from "@configs/database.config";
import { emitVideoProgress } from "@configs/socket.config";
import { VideoProcessPayload } from "@types";
import { processVideoFromStorage } from "@services/uploader.service";
import logger from "@utils/logger";


export const handleVideoProcess = async (
  payload: VideoProcessPayload,
): Promise<void> => {
  const { videoId, userId, channelId, title, description, fileName } = payload;

  try {
    logger.info(`🎬 Starting video processing: ${videoId}`);

    // Progress callback - emit to user via Socket.IO
    const onProgress = (quality: string, percent: number) => {
      emitVideoProgress(userId, videoId, {
        quality,
        percent,
        stage: "transcoding",
      });
    };

    // Process video with FFmpeg and upload HLS to MinIO
    const result = await processVideoFromStorage(videoId, fileName, onProgress);

    // Emit upload stage
    emitVideoProgress(userId, videoId, {
      quality: "all",
      percent: 100,
      stage: "uploading",
    });

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

    // Emit complete
    emitVideoProgress(userId, videoId, {
      quality: "all",
      percent: 100,
      stage: "complete",
    });

    logger.info(`✅ Video processed and saved: ${videoId}`);
  } catch (error) {
    // Emit error
    emitVideoProgress(userId, videoId, {
      quality: "all",
      percent: 0,
      stage: "error",
    });

    logger.error(`Failed to process video ${videoId}:`, error);
    throw error;
  }
};
