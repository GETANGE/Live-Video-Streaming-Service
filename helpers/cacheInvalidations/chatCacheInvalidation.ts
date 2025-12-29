import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const CACHE_TTL = 300;
const VERSION_KEY = "chat:version";

const chatCacheKey = (version: string, key: string) => `chat:${version}:${key}`;

const getVersion = async (): Promise<string> => {
  let version = await redisClient.get(VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(VERSION_KEY, version);
  }
  return version;
};

export const getChatCacheKeys = async () => {
  const version = await getVersion();

  return {
    history: (streamId: string, page: number, limit: number) =>
      chatCacheKey(version, `history:${streamId}:${page}:${limit}`),
    pinned: (streamId: string) => chatCacheKey(version, `pinned:${streamId}`),
    message: (messageId: string) =>
      chatCacheKey(version, `message:${messageId}`),
  };
};

export const invalidateChatCache = async (): Promise<void> => {
  await redisClient.incr(VERSION_KEY);
  logger.info("Chat cache invalidated (version incremented)");
};

export const getChatHistoryCache = async (
  streamId: string,
  page: number,
  limit: number,
) => {
  const keys = await getChatCacheKeys();
  const cached = await redisClient.get(keys.history(streamId, page, limit));
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setChatHistoryCache = async (
  streamId: string,
  page: number,
  limit: number,
  data: unknown,
) => {
  const keys = await getChatCacheKeys();
  await redisClient.setex(
    keys.history(streamId, page, limit),
    CACHE_TTL,
    JSON.stringify(data),
  );
};

export const getPinnedMessagesCache = async (streamId: string) => {
  const keys = await getChatCacheKeys();
  const cached = await redisClient.get(keys.pinned(streamId));
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const setPinnedMessagesCache = async (
  streamId: string,
  data: unknown,
) => {
  const keys = await getChatCacheKeys();
  await redisClient.setex(
    keys.pinned(streamId),
    CACHE_TTL,
    JSON.stringify(data),
  );
};
