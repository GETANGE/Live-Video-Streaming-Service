import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const VERSION_KEY = "wordfilter:version";

const wordFilterCacheKey = (version: string, key: string) =>
  `wordfilter:${version}:${key}`;

const getVersion = async (): Promise<string> => {
  let version = await redisClient.get(VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(VERSION_KEY, version);
  }
  return version;
};

export const getWordFilterCacheKeys = async () => {
  const version = await getVersion();

  return {
    blockedWords: () => wordFilterCacheKey(version, "blocked"),
    blockedPatterns: () => wordFilterCacheKey(version, "patterns"),
    recentMessages: (streamId: string, userId: string) =>
      wordFilterCacheKey(version, `recent:${streamId}:${userId}`),
  };
};

export const invalidateWordFilterCache = async (): Promise<void> => {
  await redisClient.incr(VERSION_KEY);
  logger.info("Word filter cache invalidated (version incremented)");
};
