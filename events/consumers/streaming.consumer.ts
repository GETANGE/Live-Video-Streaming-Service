import { getRabbitMQChannel } from "@configs/rabbitMQ.config";
import { handleUserProfileUpdate } from "./eventHandlers/user_handlers/update_profile";
import RabbitMQConfig from "@constants/constant";
import logger from "@utils/logger";

const allowedEventTypes = new Set([
  "USER_PROFILE_UPDATE"
]);

const MAX_RETRIES = 3;

// processing mesages from the queue based on priority.
export const consumeMessage = async () => {
  const channel = await getRabbitMQChannel();

  logger.info("💥 Live video consumer started...");

  channel.consume(
    RabbitMQConfig.queueName,
    async (msg: any) => {
      if (!msg) return;

      let data: any = JSON.parse(msg.content.toString());

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
          case "USER_PROFILE_UPDATE":
            await handleUserProfileUpdate(data.payload);
            break;
        }

        channel.ack(msg);
      } catch (err) {
        logger.error("Message processing failed, discarding:", err);
        channel.nack(msg, false, false);
      }
    },
    {
      noAck: false,
    },
  );
};
