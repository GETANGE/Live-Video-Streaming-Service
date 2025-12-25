import { getVideoChannel, getRabbitMQChannel } from "@configs/rabbitMQ.config";
import { handleVideoProcess } from "./eventHandlers/video_handlers/video_process";
import { handleVideoThumbnail } from "./eventHandlers/video_handlers/video_thumbnail";
import { handleVideoDelete } from "./eventHandlers/video_handlers/video_delete";
import { handleChannelDeleted } from "./eventHandlers/channel_handlers/channel_deleted";
import RabbitMQConfig, { QUEUES } from "@constants/constant";
import logger from "@utils/logger";

const MAX_RETRIES = 3;

// Video-specific event handlers (heavy operations)
const videoEventHandlers: Record<string, (payload: any) => Promise<void>> = {
  VIDEO_PROCESS: handleVideoProcess,
  VIDEO_THUMBNAIL: handleVideoThumbnail,
  VIDEO_DELETE: handleVideoDelete,
  CHANNEL_DELETED: handleChannelDeleted,
};

let activeJobs = 0;

export const getVideoQueueMetrics = () => ({
  activeJobs,
  prefetch: QUEUES.VIDEO.prefetch,
  queueName: QUEUES.VIDEO.name,
});

export const consumeVideoQueue = async () => {
  const channel = await getVideoChannel();

  logger.info(`Video consumer started (prefetch: ${QUEUES.VIDEO.prefetch})`);

  channel.consume(
    QUEUES.VIDEO.name,
    async (msg: any) => {
      if (!msg) return;

      let data: any;
      try {
        data = JSON.parse(msg.content.toString());
      } catch {
        logger.error("[VIDEO] Failed to parse message");
        channel.nack(msg, false, false);
        return;
      }

      const handler = videoEventHandlers[data.eventType];
      if (!handler) {
        channel.nack(msg, false, false);
        return;
      }

      const retries = msg.properties.headers?.["x-retries"] ?? 0;
      activeJobs++;

      try {
        logger.info(`[VIDEO] Processing: ${data.eventType} (active: ${activeJobs})`);
        await handler(data.payload);
        channel.ack(msg);
        logger.info(`[VIDEO] Completed: ${data.eventType}`);
      } catch (err) {
        logger.error(`[VIDEO] Failed (${retries + 1}/${MAX_RETRIES}):`, err);

        if (retries < MAX_RETRIES - 1) {
          // Requeue with retry count
          const mainChannel = await getRabbitMQChannel();
          mainChannel.publish(
            RabbitMQConfig.exchangeName,
            QUEUES.VIDEO.routingKey,
            msg.content,
            {
              persistent: true,
              headers: { "x-retries": retries + 1 },
              priority: msg.properties.priority,
            },
          );
          channel.ack(msg);
        } else {
          logger.error(`[VIDEO] Message discarded after ${MAX_RETRIES} retries`);
          channel.nack(msg, false, false);
        }
      } finally {
        activeJobs--;
      }
    },
    { noAck: false },
  );
};
