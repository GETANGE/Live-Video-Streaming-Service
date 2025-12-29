import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const CACHE_TTL = 86400;
const VERSION_KEY = "stream:viewers:version";

const viewerCacheKey = (version: string, key: string) =>
  `stream:viewers:${version}:${key}`;

const getVersion = async (): Promise<string> => {
  let version = await redisClient.get(VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(VERSION_KEY, version);
  }
  return version;
};

export const getViewerCacheKeys = async () => {
  const version = await getVersion();

  return {
    viewers: (streamId: string) => viewerCacheKey(version, `viewers:${streamId}`),
    socketStreams: (socketId: string) => viewerCacheKey(version, `socket:${socketId}`),
  };
};

export const invalidateViewerCache = async (): Promise<void> => {
  await redisClient.incr(VERSION_KEY);
  logger.info("Viewer cache invalidated (version incremented)");
};

export const addViewer = async (streamId: string, socketId: string) => {
  const keys = await getViewerCacheKeys();
  await redisClient.sadd(keys.viewers(streamId), socketId);
  await redisClient.sadd(keys.socketStreams(socketId), streamId);
  await redisClient.expire(keys.viewers(streamId), CACHE_TTL);
  await redisClient.expire(keys.socketStreams(socketId), CACHE_TTL);
};

export const removeViewer = async (streamId: string, socketId: string) => {
  const keys = await getViewerCacheKeys();
  await redisClient.srem(keys.viewers(streamId), socketId);
  await redisClient.srem(keys.socketStreams(socketId), streamId);
};

export const getSocketStreams = async (socketId: string): Promise<string[]> => {
  const keys = await getViewerCacheKeys();
  return redisClient.smembers(keys.socketStreams(socketId));
};

export const cleanupSocket = async (socketId: string) => {
  const keys = await getViewerCacheKeys();
  await redisClient.del(keys.socketStreams(socketId));
};

export const getViewerMetrics = async () => {
  const version = await getVersion();
  const pattern = `stream:viewers:${version}:viewers:*`;
  const viewerKeys = await redisClient.keys(pattern);

  let totalViewers = 0;
  for (const key of viewerKeys) {
    totalViewers += await redisClient.scard(key);
  }

  return {
    activeStreams: viewerKeys.length,
    totalViewers,
  };
};
