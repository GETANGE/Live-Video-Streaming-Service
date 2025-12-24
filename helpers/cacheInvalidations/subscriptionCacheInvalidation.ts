import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const SUBSCRIPTION_VERSION_KEY = "subscription:version";

const subscriptionKey = (version: string, key: string) =>
  `${SUBSCRIPTION_VERSION_KEY}:${key}:${version}`;

const getSubscriptionVersion = async () => {
  let version = await redisClient.get(SUBSCRIPTION_VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(SUBSCRIPTION_VERSION_KEY, version);
  }
  return version;
};

export const getSubscriptionCacheKeys = async () => {
  const version = await getSubscriptionVersion();

  return {
    byId: (id: string) => subscriptionKey(version, `id:${id}`),

    byUserId: (userId: string) => subscriptionKey(version, `user:${userId}`),

    all: () => subscriptionKey(version, `all`),
  };
};

export const invalidateSubscriptionCache = async () => {
  await redisClient.incr(SUBSCRIPTION_VERSION_KEY);
  logger.info("🧹 Subscription cache invalidated");
};
