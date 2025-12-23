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
import RabbitMQConfig from "@constants/constant";
import { BackpressureState } from "@types";
import logger from "@utils/logger";

const allowedEventTypes = new Set([
  // User events
  "USER_PROFILE_UPDATE",
  // Subscription events
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_RENEWED",
  "SUBSCRIPTION_EXPIRED",
  "SUBSCRIPTION_EXPIRING_SOON",
  "SUBSCRIPTION_BATCH_CREATE",
  // Notification events
  "NOTIFICATION_MARK_READ",
  "NOTIFICATION_MARK_ALL_READ",
  "NOTIFICATION_DELETE",
]);

const MAX_RETRIES = 3;
const BACKPRESSURE_THRESHOLD = 100; // Max messages being processed before pausing
const RESUME_THRESHOLD = 50; // Resume when processing queue drops below this
const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 30000;

const backpressureState: BackpressureState = {
  inFlightCount: 0,
  isPaused: false,
  consumerTag: null,
};

// Calculate exponential backoff with jitter
const calculateBackoff = (retries: number): number => {
  const exponentialDelay = INITIAL_BACKOFF_MS * Math.pow(2, retries);
  const jitter = Math.random() * exponentialDelay * 0.1;
  return Math.min(exponentialDelay + jitter, MAX_BACKOFF_MS);
};

// Pause consumer when under backpressure
const pauseConsumer = async (channel: any) => {
  if (backpressureState.isPaused || !backpressureState.consumerTag) return;

  logger.warn(
    `⏸️  Backpressure: Pausing consumer (in-flight: ${backpressureState.inFlightCount})`,
  );
  await channel.cancel(backpressureState.consumerTag);
  backpressureState.isPaused = true;
};

// Resume consumer when backpressure subsides
const resumeConsumer = async (channel: any, consumeCallback: Function) => {
  if (!backpressureState.isPaused) return;

  logger.info(
    `▶️  Backpressure: Resuming consumer (in-flight: ${backpressureState.inFlightCount})`,
  );
  const { consumerTag } = await channel.consume(
    RabbitMQConfig.queueName,
    consumeCallback,
    { noAck: false },
  );
  backpressureState.consumerTag = consumerTag;
  backpressureState.isPaused = false;
};

// Check and apply backpressure
const checkBackpressure = async (channel: any, consumeCallback: Function) => {
  if (
    backpressureState.inFlightCount >= BACKPRESSURE_THRESHOLD &&
    !backpressureState.isPaused
  ) {
    await pauseConsumer(channel);
  } else if (
    backpressureState.inFlightCount <= RESUME_THRESHOLD &&
    backpressureState.isPaused
  ) {
    await resumeConsumer(channel, consumeCallback);
  }
};

// Get backpressure metrics for monitoring
export const getBackpressureMetrics = () => ({
  inFlightCount: backpressureState.inFlightCount,
  isPaused: backpressureState.isPaused,
  threshold: BACKPRESSURE_THRESHOLD,
  resumeThreshold: RESUME_THRESHOLD,
});

// Processing messages from the queue based on priority with backpressure
export const consumeMessage = async () => {
  const channel = await getRabbitMQChannel();

  logger.info("💥 Live video consumer started with backpressure support...");

  const messageHandler = async (msg: any) => {
    if (!msg) return;

    backpressureState.inFlightCount++;

    let data: any;
    try {
      data = JSON.parse(msg.content.toString());
    } catch (parseError) {
      logger.error("Failed to parse message content:", parseError);
      channel.nack(msg, false, false);
      backpressureState.inFlightCount--;
      await checkBackpressure(channel, messageHandler);
      return;
    }

    if (!data) {
      channel.nack(msg, false, false);
      backpressureState.inFlightCount--;
      await checkBackpressure(channel, messageHandler);
      return;
    }

    if (!data.eventType || !allowedEventTypes.has(data.eventType)) {
      channel.nack(msg, false, false);
      backpressureState.inFlightCount--;
      await checkBackpressure(channel, messageHandler);
      return;
    }

    const retries = msg.properties.headers?.["x-retries"] ?? 0;

    try {
      switch (data.eventType) {
        // User events
        case "USER_PROFILE_UPDATE":
          await handleUserProfileUpdate(data.payload);
          break;

        // Subscription events
        case "SUBSCRIPTION_CREATED":
          await handleSubscriptionCreated(data.payload);
          break;
        case "SUBSCRIPTION_CANCELLED":
          await handleSubscriptionCancelled(data.payload);
          break;
        case "SUBSCRIPTION_RENEWED":
          await handleSubscriptionRenewed(data.payload);
          break;
        case "SUBSCRIPTION_EXPIRED":
          await handleSubscriptionExpired(data.payload);
          break;
        case "SUBSCRIPTION_EXPIRING_SOON":
          await handleSubscriptionExpiringSoon(data.payload);
          break;
        case "SUBSCRIPTION_BATCH_CREATE":
          await handleSubscriptionBatchCreate(data.payload);
          break;

        // Notification events
        case "NOTIFICATION_MARK_READ":
          await handleNotificationMarkRead(data.payload);
          break;
        case "NOTIFICATION_MARK_ALL_READ":
          await handleNotificationMarkAllRead(data.payload);
          break;
        case "NOTIFICATION_DELETE":
          await handleNotificationDelete(data.payload);
          break;
      }

      channel.ack(msg);
    } catch (err) {
      logger.error(
        `Message processing failed (attempt ${retries + 1}/${MAX_RETRIES}):`,
        err,
      );

      if (retries < MAX_RETRIES - 1) {
        // Requeue with exponential backoff
        const backoffMs = calculateBackoff(retries);
        logger.info(
          `Retrying message in ${backoffMs}ms (attempt ${retries + 2})`,
        );

        setTimeout(() => {
          channel.publish(
            RabbitMQConfig.exchangeName,
            RabbitMQConfig.routingKey,
            msg.content,
            {
              persistent: true,
              headers: { "x-retries": retries + 1 },
              priority: msg.properties.priority,
              contentType: "application/json",
            },
          );
        }, backoffMs);

        channel.ack(msg); // Ack original message after scheduling retry
      } else {
        logger.error(`Message discarded after ${MAX_RETRIES} attempts`);
        channel.nack(msg, false, false); // Send to dead-letter queue if configured
      }
    } finally {
      backpressureState.inFlightCount--;
      await checkBackpressure(channel, messageHandler);
    }
  };

  const { consumerTag } = await channel.consume(
    RabbitMQConfig.queueName,
    messageHandler,
    { noAck: false },
  );

  backpressureState.consumerTag = consumerTag;
};
