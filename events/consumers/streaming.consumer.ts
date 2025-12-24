import { getRabbitMQChannel } from "@configs/rabbitMQ.config";
import { handleUserProfileUpdate } from "./eventHandlers/user_handlers/update_profile";
import { handleSubscriptionCancelled } from "./eventHandlers/subscription_handlers/subscribe_cancel";
import { handleSubscriptionCreated } from "./eventHandlers/subscription_handlers/subscribe_channel";
import { handleSubscriptionExpired } from "./eventHandlers/subscription_handlers/subscribe_expired";
import { handleSubscriptionRenewed } from "./eventHandlers/subscription_handlers/subscribe_renew";
import { handleSubscriptionExpiringSoon } from "./eventHandlers/subscription_handlers/subscribe_expire_rem";
import { handleSubscriptionBatchCreate } from "./eventHandlers/subscription_handlers/subscribe_batch";
import { handleNotificationDelete } from "./eventHandlers/notification_handlers/notification_delete";
import { handleNotificationMarkAllRead } from "./eventHandlers/notification_handlers/notification_readAll";
import { handleNotificationMarkRead } from "./eventHandlers/notification_handlers/notification_read";
import { handlePaymentInitiated } from "./eventHandlers/payment_handlers/payment_initiated";
import { handlePaymentCallback } from "./eventHandlers/payment_handlers/payment_callback";
import { handleVideoProcess } from "./eventHandlers/video_handlers/video_process";
import RabbitMQConfig from "@constants/constant";
import logger from "@utils/logger";

const MAX_RETRIES = 3;
const PREFETCH_COUNT = 10;

const eventHandlers: Record<string, (payload: any) => Promise<void>> = {
  // User events
  USER_PROFILE_UPDATE: handleUserProfileUpdate,
  // Subscription events
  SUBSCRIPTION_CREATED: handleSubscriptionCreated,
  SUBSCRIPTION_CANCELLED: handleSubscriptionCancelled,
  SUBSCRIPTION_RENEWED: handleSubscriptionRenewed,
  SUBSCRIPTION_EXPIRED: handleSubscriptionExpired,
  SUBSCRIPTION_EXPIRING_SOON: handleSubscriptionExpiringSoon,
  SUBSCRIPTION_BATCH_CREATE: handleSubscriptionBatchCreate,
  // Notification events
  NOTIFICATION_MARK_READ: handleNotificationMarkRead,
  NOTIFICATION_MARK_ALL_READ: handleNotificationMarkAllRead,
  NOTIFICATION_DELETE: handleNotificationDelete,
  // Payment events
  PAYMENT_INITIATED: handlePaymentInitiated,
  PAYMENT_CALLBACK: handlePaymentCallback,
  // Video events
  VIDEO_PROCESS: handleVideoProcess,
};

export const getBackpressureMetrics = () => ({
  prefetchCount: PREFETCH_COUNT,
  healthy: true,
});

export const consumeMessage = async () => {
  const channel = await getRabbitMQChannel();

  // Prefetch limits unacked messages - RabbitMQ handles backpressure
  await channel.prefetch(PREFETCH_COUNT);

  logger.info("💫 Consumer started...");

  channel.consume(
    RabbitMQConfig.queueName,
    async (msg: any) => {
      if (!msg) return;

      let data: any;
      try {
        data = JSON.parse(msg.content.toString());
      } catch {
        logger.error("Failed to parse message");
        channel.nack(msg, false, false);
        return;
      }

      const handler = eventHandlers[data.eventType];
      if (!handler) {
        logger.warn(`Unknown event type: ${data.eventType}`);
        channel.nack(msg, false, false);
        return;
      }

      const retries = msg.properties.headers?.["x-retries"] ?? 0;

      try {
        await handler(data.payload);
        channel.ack(msg);
      } catch (err) {
        logger.error(`Processing failed (${retries + 1}/${MAX_RETRIES}):`, err);

        if (retries < MAX_RETRIES - 1) {
          // Requeue with retry count
          channel.publish(
            RabbitMQConfig.exchangeName,
            RabbitMQConfig.routingKey,
            msg.content,
            {
              persistent: true,
              headers: { "x-retries": retries + 1 },
              priority: msg.properties.priority,
            },
          );
          channel.ack(msg);
        } else {
          logger.error("Message discarded after max retries");
          channel.nack(msg, false, false);
        }
      }
    },
    { noAck: false },
  );
};
