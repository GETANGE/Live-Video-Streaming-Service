import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const CACHE_TTL = 3600;
const VERSION_KEY = "streamkey:version";

const streamkeyCacheKey = (version: string, key: string) =>
  `streamkey:${version}:${key}`;

const getVersion = async (): Promise<string> => {
  let version = await redisClient.get(VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(VERSION_KEY, version);
  }
  return version;
};

export const getStreamKeyCacheKeys = async () => {
  const version = await getVersion();

  return {
    byId: (id: string) => streamkeyCacheKey(version, `id:${id}`),
    byKey: (key: string) => streamkeyCacheKey(version, `key:${key}`),
    byUser: (userId: string) => streamkeyCacheKey(version, `user:${userId}`),
    byChannel: (channelId: string) =>
      streamkeyCacheKey(version, `channel:${channelId}`),
  };
};

export const invalidateStreamKeyCache = async (): Promise<void> => {
  await redisClient.incr(VERSION_KEY);
  logger.info("Stream key cache invalidated (version incremented)");
};

export const getStreamKeyByIdCache = async (id: string) => {
  const keys = await getStreamKeyCacheKeys();
  const cached = await redisClient.get(keys.byId(id));
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setStreamKeyByIdCache = async (id: string, data: unknown) => {
  const keys = await getStreamKeyCacheKeys();
  await redisClient.setex(keys.byId(id), CACHE_TTL, JSON.stringify(data));
};

export const getStreamKeyByKeyCache = async (key: string) => {
  const keys = await getStreamKeyCacheKeys();
  const cached = await redisClient.get(keys.byKey(key));
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setStreamKeyByKeyCache = async (key: string, data: unknown) => {
  const keys = await getStreamKeyCacheKeys();
  await redisClient.setex(keys.byKey(key), CACHE_TTL, JSON.stringify(data));
};

export const getStreamKeysByUserCache = async (userId: string) => {
  const keys = await getStreamKeyCacheKeys();
  const cached = await redisClient.get(keys.byUser(userId));
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setStreamKeysByUserCache = async (
  userId: string,
  data: unknown
) => {
  const keys = await getStreamKeyCacheKeys();
  await redisClient.setex(keys.byUser(userId), CACHE_TTL, JSON.stringify(data));
};

export const getStreamKeysByChannelCache = async (channelId: string) => {
  const keys = await getStreamKeyCacheKeys();
  const cached = await redisClient.get(keys.byChannel(channelId));
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setStreamKeysByChannelCache = async (
  channelId: string,
  data: unknown
) => {
  const keys = await getStreamKeyCacheKeys();
  await redisClient.setex(
    keys.byChannel(channelId),
    CACHE_TTL,
    JSON.stringify(data)
  );
};
