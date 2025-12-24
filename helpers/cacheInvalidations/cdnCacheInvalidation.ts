import logger from "@utils/logger";
import redisClient from "@configs/redis.config";

// Version-based cache config
const CDN_VERSION_KEY = "cdn:version";

const cdnCacheKey = (version: string, key: string) =>
  `cdn:${version}:${key}`;

const getCDNVersion = async (): Promise<string> => {
  let version = await redisClient.get(CDN_VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(CDN_VERSION_KEY, version);
  }
  return version;
};

export const getCDNCacheKeys = async () => {
  const version = await getCDNVersion();

  return {
    thumbnail: (id: string) => cdnCacheKey(version, `thumbnail:${id}`),
    video: (id: string) => cdnCacheKey(version, `video:${id}`),
    stream: (id: string) => cdnCacheKey(version, `stream:${id}`),
  };
};

export const invalidateCDNCache = async (): Promise<void> => {
  await redisClient.incr(CDN_VERSION_KEY);
  logger.info("CDN cache invalidated (version incremented)");
};