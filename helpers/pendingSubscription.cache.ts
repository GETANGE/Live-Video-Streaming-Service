import redisClient from "@configs/redis.config";
import { PendingSubscription } from "@types";
import logger from "@utils/logger";

const PENDING_SUBSCRIPTION_PREFIX = "pending_subscription";
const PENDING_SUBSCRIPTION_TTL = 3600; // 1 hour

/**
 * Store a pending subscription while waiting for payment
 */
export const storePendingSubscription = async (
  checkoutRequestId: string,
  data: PendingSubscription,
): Promise<void> => {
  const key = `${PENDING_SUBSCRIPTION_PREFIX}:${checkoutRequestId}`;
  await redisClient.setex(key, PENDING_SUBSCRIPTION_TTL, JSON.stringify(data));
  logger.info(`Stored pending subscription for checkout: ${checkoutRequestId}`);
};

/**
 * Retrieve pending subscription by checkout request ID
 */
export const getPendingSubscription = async (
  checkoutRequestId: string,
): Promise<PendingSubscription | null> => {
  const key = `${PENDING_SUBSCRIPTION_PREFIX}:${checkoutRequestId}`;
  const data = await redisClient.get(key);

  if (!data) return null;

  return JSON.parse(data);
};

/**
 * Remove pending subscription after processing
 */
export const removePendingSubscription = async (
  checkoutRequestId: string,
): Promise<void> => {
  const key = `${PENDING_SUBSCRIPTION_PREFIX}:${checkoutRequestId}`;
  await redisClient.del(key);
  logger.info(
    `Removed pending subscription for checkout: ${checkoutRequestId}`,
  );
};

/**
 * Check if user has a pending subscription for a channel
 */
export const hasPendingSubscription = async (
  userId: string,
  channelId: string,
): Promise<boolean> => {
  const pattern = `${PENDING_SUBSCRIPTION_PREFIX}:*`;
  const keys = await redisClient.keys(pattern);

  for (const key of keys) {
    const data = await redisClient.get(key);
    if (data) {
      const pending: PendingSubscription = JSON.parse(data);
      if (pending.userId === userId && pending.channelId === channelId) {
        return true;
      }
    }
  }

  return false;
};
