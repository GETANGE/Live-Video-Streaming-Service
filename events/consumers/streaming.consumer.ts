import { getRabbitMQChannel } from "@configs/rabbitMQ.config";
import RabbitMQConfig from "@constants/constant";
import logger from "@utils/logger";

const allowedEventTypes = new Set([
  "VIDEO_TRANSCODE",
  "STREAM_STARTED",
  "STREAM_ENDED",
  "NOTIFY_VIEWERS",
]);

const MAX_RETRIES = 3;

// reading mesages from the queue.
export const consumeMessage = async () => {
  const channel = await getRabbitMQChannel();
  
  logger.info("💥 Live video consumer started...")

  channel.consume(
    RabbitMQConfig.queueName,
    async (msg: any) => {
      if (!msg) return;

      let data: any;

        data = JSON.parse(msg.content.toString());
        if (!data) {
          channel.nack(msg, false, false);
          return;
        }

      if (!data.eventType || !allowedEventTypes.has(data.eventType)) {
        channel.nack(msg, false, false);
        return;
      }

      const retries = msg.properties.headers?.["x-retries"] ?? 0;

      try {
        switch (data.eventType) {
          // case "VIDEO_TRANSCODE":
          //   await handleVideoTranscode(data.payload);
          //   break;

          // case "STREAM_STARTED":
          //   await handleStreamStarted(data.payload);
          //   break;

          // case "STREAM_ENDED":
          //   await handleStreamEnded(data.payload);
          //   break;

          // case "NOTIFY_VIEWERS":
          //   await handleNotifyViewers(data.payload);
          //   break;
        }

        channel.ack(msg);
      } catch (err) {
        console.error("❌ Message processing failed:", err);

        if (retries >= MAX_RETRIES) {
          // Permanent failure → DLQ / discard
          channel.nack(msg, false, false);
        } else {
          // Requeue with retry count
          channel.nack(msg, false, true);
        }
      }
    },
    {
      noAck: false,
    },
  );
};
