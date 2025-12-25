import logger from "@utils/logger";
import { Subscription } from "@types";
import * as repo from "@repository/notification.repository";
import {
  EVENT_TYPES,
  publishSubscriptionEventAsync,
  notifyChannelOwner,
  notifyUser,
} from "@helpers/event.helper";

export const SUBSCRIPTION_EVENTS = {
  SUBSCRIBED: EVENT_TYPES.SUBSCRIPTION_CREATED,
  UNSUBSCRIBED: EVENT_TYPES.SUBSCRIPTION_CANCELLED,
  RENEWED: EVENT_TYPES.SUBSCRIPTION_RENEWED,
  EXPIRED: EVENT_TYPES.SUBSCRIPTION_EXPIRED,
  EXPIRING_SOON: EVENT_TYPES.SUBSCRIPTION_EXPIRING_SOON,
} as const;

// Notify on new subscription
export const notifyNewSubscription = async (subscription: Subscription) => {
  await repo.createNotification({
    message: `New subscriber to your channel`,
    type: "INFO",
    userId: subscription.channelId, // channel owner
  });

  publishSubscriptionEventAsync(SUBSCRIPTION_EVENTS.SUBSCRIBED, subscription);
  notifyChannelOwner(subscription.channelId, subscription.userId, "subscribed");
};

// Notify on subscription renewal
export const notifySubscriptionRenewed = async (subscription: Subscription) => {
  await repo.createNotification({
    message: `Subscription renewed`,
    type: "INFO",
    userId: subscription.userId,
  });

  publishSubscriptionEventAsync(SUBSCRIPTION_EVENTS.RENEWED, subscription);
};

// Notify on unsubscribe
export const notifyUnsubscribed = async (subscription: Subscription) => {
  publishSubscriptionEventAsync(SUBSCRIPTION_EVENTS.UNSUBSCRIBED, subscription);
};

// Send expiring subscription reminders
export const sendExpirationReminders = async (subscriptions: Subscription[]) => {
  const notifications = subscriptions
    .filter((s) => s.user?.id)
    .map((s) => ({
      message: `Your subscription to ${s.channel?.name} expires soon`,
      type: "ALERT" as const,
      userId: s.user!.id,
    }));

  if (notifications.length > 0) {
    await repo.createManyNotifications(notifications);
  }

  for (const subscription of subscriptions) {
    publishSubscriptionEventAsync(SUBSCRIPTION_EVENTS.EXPIRING_SOON, subscription);

    if (subscription.user?.id) {
      notifyUser(subscription.user.id, {
        type: "SUBSCRIPTION_EXPIRING",
        message: `Your subscription to ${subscription.channel?.name} expires soon`,
        channelId: subscription.channelId,
        expiresAt: subscription.endDate,
      });
    }
  }

  logger.info(`Sent ${subscriptions.length} expiration reminders`);
  return subscriptions.length;
};
