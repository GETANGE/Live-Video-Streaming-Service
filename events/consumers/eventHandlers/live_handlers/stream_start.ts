import * as livestreamService from "@services/livestream.service";
import { emitStreamStart, emitViewerCount } from "@configs/socket-live.config";
import { StreamStartPayload } from "@types";
import logger from "@utils/logger";


export const handleStreamStart = async (
  payload: StreamStartPayload
): Promise<void> => {
  const { streamId, streamKey, channelId, streamerId } = payload;

  logger.info(`[LIVE_HANDLER] Processing stream start: ${streamId}`);

  try {
    // Update stream status to LIVE
    await livestreamService.startStream(streamKey);

    // Emit Socket.IO event to notify clients
    emitStreamStart(streamId, {
      channelId,
      streamerId,
      startedAt: new Date().toISOString(),
    });

    // Initialize viewer count
    emitViewerCount(streamId, 0);

    logger.info(`[LIVE_HANDLER] Stream started successfully: ${streamId}`);
  } catch (error: any) {
    logger.error(
      `[LIVE_HANDLER] Failed to process stream start for ${streamId}:`,
      error
    );
    throw error;
  }
};
