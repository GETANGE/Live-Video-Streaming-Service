import { getRabbitMQChannel } from "@configs/rabbitMQ.config";
import RabbitMQConfig from "@constants/constant";
import logger from "@utils/logger";

export const getPublisherMetrics = () => ({
  isBlocked: false,
  healthy: true,
});

export const publishMessage = async (payload: {
  eventType: string;
  priority?: number;
  payload: Record<string, any>;
}): Promise<void> => {
  const channel = await getRabbitMQChannel();

  channel.publish(
    RabbitMQConfig.exchangeName,
    RabbitMQConfig.routingKey,
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
      priority: payload.priority ?? 5,
      contentType: "application/json",
    },
  );

  logger.debug(`Published: ${payload.eventType}`);
};
