import { getRabbitMQChannel } from "@configs/rabbitMQ.config";
import RabbitMQConfig, { QUEUES, VIDEO_EVENTS } from "@constants/constant";
import logger from "@utils/logger";

export const getPublisherMetrics = () => ({
  isBlocked: false,
  healthy: true,
});

// Determine which queue to use based on event type
const getRoutingKey = (eventType: string): string => {
  if (VIDEO_EVENTS.includes(eventType as any)) {
    return QUEUES.VIDEO.routingKey;
  }
  return QUEUES.GENERAL.routingKey;
};

export const publishMessage = async (payload: {
  eventType: string;
  priority?: number;
  payload: Record<string, any>;
}): Promise<void> => {
  const channel = await getRabbitMQChannel();
  const routingKey = getRoutingKey(payload.eventType);

  channel.publish(
    RabbitMQConfig.exchangeName,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
      priority: payload.priority ?? 5,
      contentType: "application/json",
    },
  );

  const queueType = routingKey === QUEUES.VIDEO.routingKey ? "VIDEO" : "GENERAL";
  logger.debug(`Published: ${payload.eventType} → ${queueType} queue`);
};

// Publish directly to video queue (explicit)
export const publishVideoMessage = async (payload: {
  eventType: string;
  priority?: number;
  payload: Record<string, any>;
}): Promise<void> => {
  const channel = await getRabbitMQChannel();

  channel.publish(
    RabbitMQConfig.exchangeName,
    QUEUES.VIDEO.routingKey,
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
      priority: payload.priority ?? 5,
      contentType: "application/json",
    },
  );

  logger.debug(`Published: ${payload.eventType} → VIDEO queue`);
};

// Publish directly to general queue (explicit)
export const publishGeneralMessage = async (payload: {
  eventType: string;
  priority?: number;
  payload: Record<string, any>;
}): Promise<void> => {
  const channel = await getRabbitMQChannel();

  channel.publish(
    RabbitMQConfig.exchangeName,
    QUEUES.GENERAL.routingKey,
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
      priority: payload.priority ?? 5,
      contentType: "application/json",
    },
  );

  logger.debug(`Published: ${payload.eventType} → GENERAL queue`);
};
