import redisClient from "@configs/redis.config";
import logger from "@utils/logger";
import APIError from "@utils/APIError";
import {
  getSubscriptionCacheKeys,
  invalidateSubscriptionCache,
} from "helpers/cacheInvalidations/subscriptionCacheInvalidation";
import * as repo from "@repository/subscription.repository";


export const subscribe = async (userId: string, channelId: string) => {
  const existing = await repo.findSubscription(userId, channelId);
  if (existing) {
    throw new APIError("User already subscribed to this channel", 400);
  }

  const subscription = await repo.createSubscription(userId, channelId);

  await invalidateSubscriptionCache();

  logger.info(`Subscription ${subscription.id} created`);

  return subscription;
};

export const unsubscribe = async (userId: string, channelId: string) => {
  const existing = await repo.findSubscription(userId, channelId);
  if (!existing) {
    throw new APIError("User not subscribed to this channel", 404);
  }

  const subscription = await repo.cancelSubscription(existing.id);

  await invalidateSubscriptionCache();

  logger.info(`Subscription ${subscription.id} cancelled`);

  return subscription;
};

export const getSubscriptionsByUser = async (userId: string) => {
  
  const keys = await getSubscriptionCacheKeys();
  const cacheKey = keys.byUserId(userId);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const subscriptions = await repo.getSubscriptionsByUserId(userId);

  await redisClient.setex(cacheKey, 300, JSON.stringify(subscriptions));

  return subscriptions;
};
