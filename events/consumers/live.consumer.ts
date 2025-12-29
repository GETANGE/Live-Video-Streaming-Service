import { getLiveChannel, getRabbitMQChannel } from "@configs/rabbitMQ.config";
import RabbitMQConfig, { QUEUES } from "@constants/constant";
import logger from "@utils/logger";

import {
  handleStreamStart,
  handleStreamEnd,
  handleVodConvert,
  handleChatMessage,
  handleModerationAction,
} from "./eventHandlers/live_handlers";

const MAX_RETRIES = 3;

const handleStreamTranscode = async (payload: any): Promise<void> => {
  logger.info(`[LIVE] Stream transcode: ${payload.streamId}`);
};

// Live-specific event handlers
const liveEventHandlers: Record<string, (payload: any) => Promise<void>> = {
  STREAM_START: handleStreamStart,
  STREAM_END: handleStreamEnd,
  STREAM_TRANSCODE: handleStreamTranscode,
  VOD_CONVERT: handleVodConvert,
  CHAT_MESSAGE: handleChatMessage,
  MODERATION_ACTION: handleModerationAction,
};

let activeJobs = 0;

export const getLiveQueueMetrics = () => ({
  activeJobs,
  prefetch: QUEUES.LIVE.prefetch,
  queueName: QUEUES.LIVE.name,
});

export const consumeLiveQueue = async () => {
  const channel = await getLiveChannel();

  logger.info(`Live consumer started (prefetch: ${QUEUES.LIVE.prefetch})`);

  channel.consume(
    QUEUES.LIVE.name,
    async (msg: any) => {
      if (!msg) return;

      let data: any;
      try {
        data = JSON.parse(msg.content.toString());
      } catch {
        logger.error("[LIVE] Failed to parse message");
        channel.nack(msg, false, false);
        return;
      }

      const handler = liveEventHandlers[data.eventType];
      if (!handler) {
        logger.warn(`[LIVE] Unknown event type: ${data.eventType}`);
        channel.nack(msg, false, false);
        return;
      }

      const retries = msg.properties.headers?.["x-retries"] ?? 0;
      activeJobs++;

      try {
        logger.info(`[LIVE] Processing: ${data.eventType} (active: ${activeJobs})`);
        await handler(data.payload);
        channel.ack(msg);
        logger.info(`[LIVE] Completed: ${data.eventType}`);
      } catch (err) {
        logger.error(`[LIVE] Failed (${retries + 1}/${MAX_RETRIES}):`, err);

        if (retries < MAX_RETRIES - 1) {
          // Requeue with retry count
          const mainChannel = await getRabbitMQChannel();
          mainChannel.publish(
            RabbitMQConfig.exchangeName,
            QUEUES.LIVE.routingKey,
            msg.content,
            {
              persistent: true,
              headers: { "x-retries": retries + 1 },
              priority: msg.properties.priority,
            }
          );
          channel.ack(msg);
        } else {
          logger.error(`[LIVE] Message discarded after ${MAX_RETRIES} retries`);
          channel.nack(msg, false, false);
        }
      } finally {
        activeJobs--;
      }
    },
    { noAck: false }
  );
};
