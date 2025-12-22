import { getRabbitMQChannel } from "@configs/rabbitMQ.config";
import RabbitMQConfig from "@constants/constant";
import { PublishResult, PublisherState } from "@types";
import logger from "@utils/logger";

// Backpressure configuration
const BUFFER_LIMIT = 10000; // Max messages to buffer when channel is blocked
const DRAIN_CHECK_INTERVAL_MS = 50;
const PUBLISH_TIMEOUT_MS = 30000;

const publisherState: PublisherState = {
  isBlocked: false,
  pendingMessages: [],
  drainHandler: null,
};

// Get publisher metrics for monitoring
export const getPublisherMetrics = () => ({
  isBlocked: publisherState.isBlocked,
  pendingCount: publisherState.pendingMessages.length,
  bufferLimit: BUFFER_LIMIT,
});

// Process buffered messages when channel drains
const processPendingMessages = async () => {
  if (publisherState.isBlocked || publisherState.pendingMessages.length === 0) {
    return;
  }

  const channel = await getRabbitMQChannel();

  while (
    publisherState.pendingMessages.length > 0 &&
    !publisherState.isBlocked
  ) {
    const item = publisherState.pendingMessages.shift();
    if (!item) break;

    // Check for timeout
    if (Date.now() - item.timestamp > PUBLISH_TIMEOUT_MS) {
      item.reject(new Error("Message publish timeout"));
      continue;
    }

    try {
      const result = await publishMessageInternal(channel, item.payload);
      item.resolve(result);

      if (!result.success) {
        // Channel is blocked, put back at front of queue
        publisherState.pendingMessages.unshift(item);
        break;
      }
    } catch (error) {
      item.reject(error as Error);
    }
  }
};

// Internal publish function that checks channel write buffer
const publishMessageInternal = async (
  channel: any,
  payload: any,
): Promise<PublishResult> => {
  const messageBuffer = Buffer.from(JSON.stringify(payload));

  // channel.publish returns false if internal write buffer is full (backpressure signal)
  const canWrite = channel.publish(
    RabbitMQConfig.exchangeName,
    RabbitMQConfig.routingKey,
    messageBuffer,
    {
      persistent: true,
      headers: {
        "x-retries": 0,
      },
      priority: payload.priority ?? 5,
      contentType: "application/json",
    },
  );

  if (!canWrite) {
    // Channel buffer is full - backpressure activated
    publisherState.isBlocked = true;
    logger.warn(
      "⏸️  Publisher backpressure: Channel buffer full, pausing publishes",
    );

    // Set up drain handler if not already set
    if (!publisherState.drainHandler) {
      publisherState.drainHandler = () => {
        logger.info(
          "💧 Publisher backpressure: Channel drained, resuming publishes",
        );
        publisherState.isBlocked = false;
        publisherState.drainHandler = null;

        // Process any pending messages
        setImmediate(() => processPendingMessages());
      };

      channel.once("drain", publisherState.drainHandler);
    }

    return {
      success: false,
      queued: false,
      bufferLength: publisherState.pendingMessages.length,
    };
  }

  return {
    success: true,
    queued: false,
    bufferLength: publisherState.pendingMessages.length,
  };
};

// Send the message to the exchange with backpressure handling
export const publishMessage = async (payload: any): Promise<PublishResult> => {
  const channel = await getRabbitMQChannel();

  // If channel is blocked, add to pending queue
  if (publisherState.isBlocked) {
    if (publisherState.pendingMessages.length >= BUFFER_LIMIT) {
      logger.error(
        `❌ Publisher buffer full (${BUFFER_LIMIT}). Message rejected.`,
      );
      throw new Error("Publisher buffer full - message rejected");
    }

    return new Promise((resolve, reject) => {
      publisherState.pendingMessages.push({
        payload,
        resolve,
        reject,
        timestamp: Date.now(),
      });

      logger.debug(
        `📥 Message queued for later publish (buffer: ${publisherState.pendingMessages.length})`,
      );
    });
  }

  // Try to publish directly
  const result = await publishMessageInternal(channel, payload);

  if (!result.success) {
    // Channel became blocked, queue this message
    return new Promise((resolve, reject) => {
      publisherState.pendingMessages.unshift({
        payload,
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });
  }

  return result;
};

// Publish with timeout - useful for critical messages
export const publishMessageWithTimeout = async (
  payload: any,
  timeoutMs: number = PUBLISH_TIMEOUT_MS,
): Promise<PublishResult> => {
  return Promise.race([
    publishMessage(payload),
    new Promise<PublishResult>((_, reject) =>
      setTimeout(() => reject(new Error("Publish timeout")), timeoutMs),
    ),
  ]);
};

// Batch publish multiple messages with backpressure awareness
export const publishMessageBatch = async (
  payloads: any[],
): Promise<{ successful: number; failed: number; queued: number }> => {
  let successful = 0;
  let failed = 0;
  let queued = 0;

  for (const payload of payloads) {
    try {
      const result = await publishMessage(payload);
      if (result.success) {
        successful++;
      } else if (result.queued) {
        queued++;
      }
    } catch (error) {
      failed++;
      logger.error("Failed to publish message in batch:", error);
    }
  }

  return { successful, failed, queued };
};

// Graceful shutdown - flush pending messages
export const flushPendingMessages = async (
  timeoutMs: number = 5000,
): Promise<{ flushed: number; dropped: number }> => {
  const startTime = Date.now();
  let flushed = 0;
  const initialCount = publisherState.pendingMessages.length;

  while (
    publisherState.pendingMessages.length > 0 &&
    Date.now() - startTime < timeoutMs
  ) {
    if (!publisherState.isBlocked) {
      await processPendingMessages();
      flushed = initialCount - publisherState.pendingMessages.length;
    } else {
      await new Promise((resolve) =>
        setTimeout(resolve, DRAIN_CHECK_INTERVAL_MS),
      );
    }
  }

  const dropped = publisherState.pendingMessages.length;

  // Reject any remaining messages
  for (const item of publisherState.pendingMessages) {
    item.reject(new Error("Publisher shutdown - message dropped"));
  }
  publisherState.pendingMessages = [];

  logger.info(`📤 Publisher flush: ${flushed} flushed, ${dropped} dropped`);

  return { flushed, dropped };
};
