import * as livestreamService from "@services/livestream.service";
import { queueVodConversion } from "@services/vod-conversion.service";
import { StreamEndPayload } from "@types";
import { emitStreamEnd } from "@configs/socket-live.config";
import logger from "@utils/logger";


export const handleStreamEnd = async (
  payload: StreamEndPayload
): Promise<void> => {
  const { streamId, channelId, duration } = payload;

  logger.info(`[LIVE_HANDLER] Processing stream end: ${streamId}`);

  try {
    // Update stream status to ENDED
    await livestreamService.endStream(streamId);

    // Emit Socket.IO event to notify clients
    emitStreamEnd(streamId, {
      channelId,
      endedAt: new Date().toISOString(),
      duration,
    });

    // Queue VOD conversion (automatic for all streams)
    await queueVodConversion(streamId);

    logger.info(
      `[LIVE_HANDLER] Stream ended and VOD conversion queued: ${streamId}`
    );
  } catch (error: any) {
    logger.error(
      `[LIVE_HANDLER] Failed to process stream end for ${streamId}:`,
      error
    );
    throw error;
  }
};
