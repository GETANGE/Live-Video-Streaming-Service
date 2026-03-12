import { emitStreamStart, emitViewerCount } from "@configs/socket-live.config";
import { StreamStartPayload } from "@types";
import logger from "@utils/logger";


export const handleStreamStart = async (
  payload: StreamStartPayload
): Promise<void> => {
  const { streamId, channelId, streamerId } = payload;

  logger.info(`[LIVE_HANDLER] Processing stream start: ${streamId}`);

  try {
    // Stream is already started by the NMS callback (rtmp-callback.controller)
    // Here we just emit Socket.IO events to notify connected clients

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
