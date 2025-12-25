import redisClient from "@configs/redis.config";
import logger from "@utils/logger";
import APIError from "@utils/APIError";
import {
  getSubscriptionCacheKeys,
  invalidateSubscriptionCache,
} from "@helpers/cacheInvalidations/subscriptionCacheInvalidation";
import * as repo from "@repository/subscription.repository";
import * as channelRepo from "@repository/channel.repository";
import { PaginationParams } from "@types";
import * as notificationService from "@services/notification.service";

// Centralized cache helper
const getCached = async <T>(cacheKey: string, fetchFn: () => Promise<T>, ttl: number = 300): Promise<T> => {
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const data = await fetchFn();
  if (data !== null && data !== undefined) {
    await redisClient.setex(cacheKey, ttl, JSON.stringify(data));
  }
  return data as T;
};

// Subscribe to a channel
export const subscribe = async (
  userId: string,
  channelId: string,
  endDate?: Date,
) => {
  // Check if channel exists and if it's paid
  const channel = await channelRepo.getChannelById(channelId);
  if (!channel) {
    throw new APIError("Channel not found", 404);
  }

  // If channel is paid, require payment first
  if (channel.isPaid) {
    throw new APIError(
      `This is a paid channel. Subscription costs ${channel.currency} ${channel.subscriptionPrice}. Use /api/v1/payments/subscribe-channel to pay and subscribe.`,
      402 // Payment Required
    );
  }

  // Check for existing subscription
  const existing = await repo.findSubscription(userId, channelId);

  if (existing) {
    if (existing.status === "ACTIVE") {
      throw new APIError("Already subscribed to this channel", 400);
    }

    // Reactivate cancelled/expired subscription
    const subscription = await repo.reactivateSubscription(existing.id, endDate);
    await invalidateSubscriptionCache();

    await notificationService.notifySubscriptionRenewed(subscription);

    logger.info(`Subscription ${subscription.id} reactivated`);
    return subscription;
  }

  // Create new subscription
  const subscription = await repo.createSubscription(userId, channelId, endDate);
  await invalidateSubscriptionCache();

  await notificationService.notifyNewSubscription(subscription);

  logger.info(`Subscription ${subscription.id} created`);
  return subscription;
};

// Subscribe with payment (called after successful payment for paid channels)
export const subscribeWithPayment = async (
  userId: string,
  channelId: string,
  paymentId: string,
  amountPaid: number,
  endDate?: Date,
) => {
  // Check for existing subscription
  const existing = await repo.findSubscription(userId, channelId);

  if (existing) {
    if (existing.status === "ACTIVE") {
      throw new APIError("Already subscribed to this channel", 400);
    }

    // Reactivate cancelled/expired subscription
    const subscription = await repo.reactivateSubscription(existing.id, endDate);
    await invalidateSubscriptionCache();

    await notificationService.notifySubscriptionRenewed(subscription);

    logger.info(`Paid subscription ${subscription.id} reactivated`);
    return subscription;
  }

  // Create new subscription with payment info
  const subscription = await repo.createSubscriptionWithPayment(
    userId,
    channelId,
    paymentId,
    amountPaid,
    endDate,
  );
  await invalidateSubscriptionCache();

  await notificationService.notifyNewSubscription(subscription);

  logger.info(`Paid subscription ${subscription.id} created for ${amountPaid}`);
  return subscription;
};

// Unsubscribe from a channel
export const unsubscribe = async (userId: string, channelId: string) => {
  const existing = await repo.findActiveSubscription(userId, channelId);

  if (!existing) {
    throw new APIError("Not subscribed to this channel", 404);
  }

  const subscription = await repo.cancelSubscription(existing.id);
  await invalidateSubscriptionCache();

  await notificationService.notifyUnsubscribed(subscription);

  logger.info(`Subscription ${subscription.id} cancelled`);
  return subscription;
};

// Get user's subscriptions with caching
export const getSubscriptionsByUser = async (
  userId: string,
  params: PaginationParams = {},
) => {
  const keys = await getSubscriptionCacheKeys();
  const cacheKey = `${keys.byUserId(userId)}:page:${params.page || 1}:limit:${params.limit || 20}`;

  return getCached(cacheKey, () =>
    repo.getSubscriptionsByUserId(userId, params),
  );
};

// Get user's active subscriptions only
export const getActiveSubscriptionsByUser = async (
  userId: string,
  params: PaginationParams = {},
) => {
  const keys = await getSubscriptionCacheKeys();
  const cacheKey = `${keys.byUserId(userId)}:active:page:${params.page || 1}`;

  return getCached(cacheKey, () =>
    repo.getActiveSubscriptionsByUserId(userId, params),
  );
};

// Get channel subscribers with cursor pagination (for large channels)
export const getChannelSubscribers = async (
  channelId: string,
  params: PaginationParams = {},
) => {
  // Don't cache cursor-based pagination (too many variations)
  return repo.getChannelSubscribers(channelId, params);
};

// Get subscriber count (cached for performance)
export const getSubscriberCount = async (
  channelId: string,
): Promise<number> => {
  const cacheKey = `channel:${channelId}:subscriber_count`;

  return getCached(cacheKey, () => repo.getChannelSubscriberCount(channelId), 60);
};

// Batch get subscriber counts (for channel listings)
export const getMultipleSubscriberCounts = async (
  channelIds: string[],
): Promise<Map<string, number>> => {
  if (channelIds.length === 0) {
    return new Map();
  }

  // Try to get from cache first
  const cacheKeys = channelIds.map((id) => `channel:${id}:subscriber_count`);
  const cached = await redisClient.mget(...cacheKeys);

  const result = new Map<string, number>();
  const uncachedIds: string[] = [];

  channelIds.forEach((id, index) => {
    if (cached[index]) {
      result.set(id, parseInt(cached[index]!, 10));
    } else {
      uncachedIds.push(id);
    }
  });

  // Fetch uncached from DB
  if (uncachedIds.length > 0) {
    const dbCounts = await repo.getMultipleChannelSubscriberCounts(uncachedIds);

    // Cache the fetched counts using pipeline
    const pipeline = redisClient.pipeline();
    dbCounts.forEach((count, channelId) => {
      result.set(channelId, count);
      pipeline.setex(`channel:${channelId}:subscriber_count`, 60, count.toString());
    });
    await pipeline.exec();
  }

  return result;
};

// Check if user is subscribed (cached)
export const isSubscribed = async (
  userId: string,
  channelId: string,
): Promise<boolean> => {
  const cacheKey = `user:${userId}:subscribed:${channelId}`;

  return getCached(cacheKey, () => repo.isUserSubscribed(userId, channelId), 300);
};

// Batch check subscription status (for UI - "Subscribe" vs "Subscribed" buttons)
export const checkMultipleSubscriptions = async (
  userId: string,
  channelIds: string[],
): Promise<Record<string, boolean>> => {
  if (channelIds.length === 0) {
    return {};
  }

  // Try cache first
  const cacheKeys = channelIds.map((id) => `user:${userId}:subscribed:${id}`);
  const cached = await redisClient.mget(...cacheKeys);

  const result: Record<string, boolean> = {};
  const uncachedIds: string[] = [];

  channelIds.forEach((id, index) => {
    if (cached[index] !== null) {
      result[id] = cached[index] === "1";
    } else {
      uncachedIds.push(id);
    }
  });

  // Fetch uncached from DB
  if (uncachedIds.length > 0) {
    const dbStatus = await repo.getUserSubscriptionStatus(userId, uncachedIds);

    const pipeline = redisClient.pipeline();
    dbStatus.forEach((subscribed, channelId) => {
      result[channelId] = subscribed;
      pipeline.setex(`user:${userId}:subscribed:${channelId}`, 300, subscribed ? "1" : "0");
    });
    await pipeline.exec();
  }

  return result;
};

// Get subscription by ID
export const getSubscriptionById = async (id: string) => {
  const keys = await getSubscriptionCacheKeys();
  return getCached(keys.byId(id), () => repo.getSubscriptionById(id));
};

// Admin: Get all subscriptions
export const getAllSubscriptions = async (
  params: PaginationParams = {},
  status?: "ACTIVE" | "CANCELLED" | "EXPIRED",
) => {
  return repo.getAllSubscriptions(params, status);
};

// Admin: Get subscription stats
export const getStats = async () => {
  const cacheKey = "subscriptions:stats";

  return getCached(cacheKey, () => repo.getSubscriptionStats(), 60);
};

// Admin: Get top channels
export const getTopChannels = async (limit: number = 10) => {
  const cacheKey = `subscriptions:top_channels:${limit}`;

  return getCached(cacheKey, () => repo.getTopChannelsBySubscribers(limit), 60);
};

// Cron: Process expired subscriptions
export const processExpiredSubscriptions = async () => {
  const result = await repo.batchExpireSubscriptions();
  await invalidateSubscriptionCache();

  logger.info(`Expired ${result.count} subscriptions`);
  return result;
};

// Cron: Get expiring subscriptions for reminders
export const getExpiringSubscriptions = async (withinDays: number = 7) => {
  return repo.getExpiringSubscriptions(withinDays);
};

// Send expiring subscription reminders
export const sendExpirationReminders = async (withinDays: number = 7) => {
  const expiring = await repo.getExpiringSubscriptions(withinDays);
  return notificationService.sendExpirationReminders(expiring);
};

// Batch subscribe (for imports)
export const batchSubscribe = async (
  subscriptions: Array<{ userId: string; channelId: string; endDate?: Date }>,
) => {
  const result = await repo.batchSubscribe(subscriptions);
  await invalidateSubscriptionCache();

  logger.info(`Batch created ${result.count} subscriptions`);
  return result;
};
