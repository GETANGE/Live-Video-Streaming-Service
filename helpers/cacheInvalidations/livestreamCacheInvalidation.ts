import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const CACHE_TTL = 86400;
const VERSION_KEY = "livestream:version";

const livestreamCacheKey = (version: string, key: string) =>
  `livestream:${version}:${key}`;

const getVersion = async (): Promise<string> => {
  let version = await redisClient.get(VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(VERSION_KEY, version);
  }
  return version;
};

export const getLivestreamCacheKeys = async () => {
  const version = await getVersion();

  return {
    byId: (id: string) => livestreamCacheKey(version, `id:${id}`),
    byStreamKey: (key: string) => livestreamCacheKey(version, `key:${key}`),
    byChannel: (channelId: string) => livestreamCacheKey(version, `channel:${channelId}`),
    byStreamer: (streamerId: string) => livestreamCacheKey(version, `streamer:${streamerId}`),
    active: () => livestreamCacheKey(version, "active"),
    all: () => livestreamCacheKey(version, "all"),
    viewerCount: (streamId: string) => livestreamCacheKey(version, `viewers:${streamId}`),
  };
};

export const invalidateLivestreamCache = async (): Promise<void> => {
  await redisClient.incr(VERSION_KEY);
  logger.info("Livestream cache invalidated (version incremented)");
};

export const getViewerCount = async (streamId: string): Promise<number> => {
  const keys = await getLivestreamCacheKeys();
  const count = await redisClient.get(keys.viewerCount(streamId));
  return count ? parseInt(count, 10) : 0;
};

export const incrementViewerCount = async (streamId: string): Promise<number> => {
  const keys = await getLivestreamCacheKeys();
  const key = keys.viewerCount(streamId);
  const count = await redisClient.incr(key);
  await redisClient.expire(key, CACHE_TTL);
  return count;
};

export const decrementViewerCount = async (streamId: string): Promise<number> => {
  const keys = await getLivestreamCacheKeys();
  const key = keys.viewerCount(streamId);
  const count = await redisClient.decr(key);
  if (count < 0) {
    await redisClient.set(key, "0");
    return 0;
  }
  return count;
};

export const setViewerCount = async (streamId: string, count: number): Promise<void> => {
  const keys = await getLivestreamCacheKeys();
  const key = keys.viewerCount(streamId);
  await redisClient.set(key, count.toString());
  await redisClient.expire(key, CACHE_TTL);
};

export const clearViewerCount = async (streamId: string): Promise<void> => {
  const keys = await getLivestreamCacheKeys();
  await redisClient.del(keys.viewerCount(streamId));
};
