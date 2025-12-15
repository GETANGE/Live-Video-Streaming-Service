import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const USER_VERSION_KEY = "user:version";


const userKey = (version: string, key: string) => `user:${key}:${version}`;


const getUserVersion = async () => {
  let version = await redisClient.get(USER_VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(USER_VERSION_KEY, version);
  }
  return version;
};

export const getUserCacheKeys = async () => {
  const version = await getUserVersion();
  return {
    byId: (id: string) => userKey(version, `id:${id}`),
    byEmail: (email: string) => userKey(version, `email:${email}`),
    all: () => userKey(version, "all"),
  };
};

export const invalidateUserCache = async () => {
  await redisClient.incr(USER_VERSION_KEY);
  logger.info("🧹 User cache invalidated");
};