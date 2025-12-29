import { processVodConversion } from "@services/vod-conversion.service";
import { VodConvertPayload } from "@types";
import logger from "@utils/logger";


export const handleVodConvert = async (
  payload: VodConvertPayload
): Promise<void> => {
  const { streamId, channelId, title } = payload;

  logger.info(
    `[LIVE_HANDLER] Processing VOD conversion: ${streamId} (${title || "Untitled"})`
  );

  try {
    // Process the VOD conversion
    // This will:
    // 1. Download HLS segments from MinIO
    // 2. Concatenate them into a single video
    // 3. Upload to MinIO as raw video
    // 4. Publish VIDEO_PROCESS event to trigger transcoding
    // 5. Update stream with VOD status
    await processVodConversion(streamId);

    logger.info(
      `[LIVE_HANDLER] VOD conversion completed for stream: ${streamId}`
    );
  } catch (error: any) {
    logger.error(
      `[LIVE_HANDLER] VOD conversion failed for stream ${streamId}:`,
      error
    );
    throw error;
  }
};
