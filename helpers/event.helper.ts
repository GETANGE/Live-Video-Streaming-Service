import { publishMessage } from "@events/producers/streaming.publisher";
import { emitNotification } from "@configs/socket.config";
import { PRIORITY } from "@constants/constant";
import logger from "@utils/logger";

// Event types
export const EVENT_TYPES = {
  // User events
  USER_PROFILE_UPDATE: "USER_PROFILE_UPDATE",

  // Subscription events
  SUBSCRIPTION_CREATED: "SUBSCRIPTION_CREATED",
  SUBSCRIPTION_CANCELLED: "SUBSCRIPTION_CANCELLED",
  SUBSCRIPTION_RENEWED: "SUBSCRIPTION_RENEWED",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",
  SUBSCRIPTION_EXPIRING_SOON: "SUBSCRIPTION_EXPIRING_SOON",
  SUBSCRIPTION_BATCH_CREATE: "SUBSCRIPTION_BATCH_CREATE",

  // Notification events
  NOTIFICATION_MARK_READ: "NOTIFICATION_MARK_READ",
  NOTIFICATION_MARK_ALL_READ: "NOTIFICATION_MARK_ALL_READ",
  NOTIFICATION_DELETE: "NOTIFICATION_DELETE",

  // Payment events
  PAYMENT_INITIATED: "PAYMENT_INITIATED",
  PAYMENT_CALLBACK: "PAYMENT_CALLBACK",

  // Video events (for future use)
  VIDEO_UPLOADED: "VIDEO_UPLOADED",
  VIDEO_PROCESSED: "VIDEO_PROCESSED",
  VIDEO_DELETED: "VIDEO_DELETED",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// Priority levels
export const EVENT_PRIORITY = {
  HIGH: PRIORITY.HIGH,
  MEDIUM: PRIORITY.MEDIUM,
  LOW: PRIORITY.LOW,
} as const;

interface EventPayload {
  [key: string]: any;
}

interface EventOptions {
  priority?: number;
  async?: boolean; // If true, don't await the publish
}

/**
 * Publish an event to RabbitMQ
 * @param eventType - Type of event
 * @param payload - Event payload data
 * @param options - Publishing options
 */
export const publishEvent = async (
  eventType: EventType,
  payload: EventPayload,
  options: EventOptions = {}
): Promise<void> => {
  const { priority = EVENT_PRIORITY.MEDIUM, async: isAsync = false } = options;

  const message = {
    eventType,
    priority,
    payload: {
      ...payload,
      timestamp: new Date().toISOString(),
    },
  };

  if (isAsync) {
    // Fire and forget - don't block
    publishMessage(message).catch((err) =>
      logger.error(`Failed to publish ${eventType} event:`, err)
    );
  } else {
    await publishMessage(message);
  }
};

/**
 * Publish event asynchronously (non-blocking)
 * @param eventType - Type of event
 * @param payload - Event payload data
 * @param priority - Event priority
 */
export const publishEventAsync = (
  eventType: EventType,
  payload: EventPayload,
  priority: number = EVENT_PRIORITY.MEDIUM
): void => {
  publishEvent(eventType, payload, { priority, async: true });
};

/**
 * Publish a subscription event
 * @param eventType - Subscription event type
 * @param subscription - Subscription data
 */
export const publishSubscriptionEvent = async (
  eventType: EventType,
  subscription: {
    id: string;
    userId: string;
    channelId: string;
    status: string;
  }
): Promise<void> => {
  await publishEvent(
    eventType,
    {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      channelId: subscription.channelId,
      status: subscription.status,
    },
    { priority: EVENT_PRIORITY.MEDIUM }
  );
};

/**
 * Publish a subscription event asynchronously
 * @param eventType - Subscription event type
 * @param subscription - Subscription data
 */
export const publishSubscriptionEventAsync = (
  eventType: EventType,
  subscription: {
    id: string;
    userId: string;
    channelId: string;
    status: string;
  }
): void => {
  publishEventAsync(eventType, {
    subscriptionId: subscription.id,
    userId: subscription.userId,
    channelId: subscription.channelId,
    status: subscription.status,
  });
};

/**
 * Send a real-time notification to a user
 * @param userId - User ID to notify
 * @param notification - Notification data
 */
export const notifyUser = async (
  userId: string,
  notification: {
    type: string;
    message: string;
    [key: string]: any;
  }
): Promise<void> => {
  await emitNotification(userId, {
    ...notification,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Send a real-time notification asynchronously
 * @param userId - User ID to notify
 * @param notification - Notification data
 */
export const notifyUserAsync = (
  userId: string,
  notification: {
    type: string;
    message: string;
    [key: string]: any;
  }
): void => {
  emitNotification(userId, {
    ...notification,
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error(`Failed to notify user ${userId}:`, err));
};

/**
 * Notify a channel room (all connected subscribers)
 * @param channelId - Channel ID
 * @param notification - Notification data
 */
export const notifyChannel = async (
  channelId: string,
  notification: {
    type: string;
    [key: string]: any;
  }
): Promise<void> => {
  await emitNotification(`channel:${channelId}`, {
    ...notification,
    channelId,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Notify channel asynchronously
 * @param channelId - Channel ID
 * @param notification - Notification data
 */
export const notifyChannelAsync = (
  channelId: string,
  notification: {
    type: string;
    [key: string]: any;
  }
): void => {
  emitNotification(`channel:${channelId}`, {
    ...notification,
    channelId,
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error(`Failed to notify channel ${channelId}:`, err));
};

/**
 * Notify channel owner of a subscriber action
 * @param channelId - Channel ID
 * @param subscriberId - Subscriber user ID
 * @param action - Action type
 */
export const notifyChannelOwner = async (
  channelId: string,
  subscriberId: string,
  action: "subscribed" | "unsubscribed"
): Promise<void> => {
  await notifyChannel(channelId, {
    type: "SUBSCRIBER_UPDATE",
    action,
    subscriberId,
  });
};

/**
 * Notify channel owner asynchronously
 * @param channelId - Channel ID
 * @param subscriberId - Subscriber user ID
 * @param action - Action type
 */
export const notifyChannelOwnerAsync = (
  channelId: string,
  subscriberId: string,
  action: "subscribed" | "unsubscribed"
): void => {
  notifyChannelAsync(channelId, {
    type: "SUBSCRIBER_UPDATE",
    action,
    subscriberId,
  });
};
