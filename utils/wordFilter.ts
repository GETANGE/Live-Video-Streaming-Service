import redisClient from "@configs/redis.config";
import { getWordFilterCacheKeys } from "@helpers/cacheInvalidations/wordFilterCacheInvalidation";


const escapeRegex = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const getBlockedWords = async (): Promise<Set<string>> => {
  const keys = await getWordFilterCacheKeys();
  const words = await redisClient.smembers(keys.blockedWords());
  return new Set(words);
};

const getBlockedPatterns = async (): Promise<RegExp[]> => {
  const keys = await getWordFilterCacheKeys();
  const patterns = await redisClient.smembers(keys.blockedPatterns());
  return patterns.map((p) => new RegExp(p, "gi"));
};

export const loadBlockedWords = async (
  words: string[],
  patterns?: string[]
): Promise<void> => {
  const keys = await getWordFilterCacheKeys();

  await redisClient.del(keys.blockedWords());
  if (words.length > 0) {
    await redisClient.sadd(
      keys.blockedWords(),
      ...words.map((w) => w.toLowerCase())
    );
  }

  if (patterns) {
    await redisClient.del(keys.blockedPatterns());
    if (patterns.length > 0) {
      await redisClient.sadd(keys.blockedPatterns(), ...patterns);
    }
  }
};

export const addBlockedWords = async (words: string[]): Promise<void> => {
  if (words.length > 0) {
    const keys = await getWordFilterCacheKeys();
    await redisClient.sadd(
      keys.blockedWords(),
      ...words.map((w) => w.toLowerCase())
    );
  }
};

export const removeBlockedWords = async (words: string[]): Promise<void> => {
  if (words.length > 0) {
    const keys = await getWordFilterCacheKeys();
    await redisClient.srem(
      keys.blockedWords(),
      ...words.map((w) => w.toLowerCase())
    );
  }
};

export const addBlockedPattern = async (pattern: string): Promise<void> => {
  const keys = await getWordFilterCacheKeys();
  await redisClient.sadd(keys.blockedPatterns(), pattern);
};

export const removeBlockedPattern = async (pattern: string): Promise<void> => {
  const keys = await getWordFilterCacheKeys();
  await redisClient.srem(keys.blockedPatterns(), pattern);
};

export const containsBlockedContent = async (
  message: string
): Promise<boolean> => {
  const lowerMessage = message.toLowerCase();
  const blockedWords = await getBlockedWords();

  for (const word of blockedWords) {
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
    if (regex.test(lowerMessage)) {
      return true;
    }
  }

  const patterns = await getBlockedPatterns();
  for (const pattern of patterns) {
    if (pattern.test(message)) {
      return true;
    }
  }

  return false;
};

export const filterMessage = async (
  message: string
): Promise<{
  filtered: string;
  wasFiltered: boolean;
  flagged: boolean;
}> => {
  let filtered = message;
  let wasFiltered = false;
  let flagged = false;

  const blockedWords = await getBlockedWords();

  for (const word of blockedWords) {
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
    if (regex.test(filtered)) {
      filtered = filtered.replace(regex, "*".repeat(word.length));
      wasFiltered = true;
    }
  }

  const patterns = await getBlockedPatterns();
  for (const pattern of patterns) {
    if (pattern.test(filtered)) {
      flagged = true;
      break;
    }
  }

  return { filtered, wasFiltered, flagged };
};

export const sanitizeMessage = (message: string): string => {
  let sanitized = message.replace(/\s+/g, " ").trim();
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, "");

  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 500);
  }

  return sanitized;
};

export const isSpam = async (
  message: string,
  userId: string,
  streamId: string
): Promise<boolean> => {
  const capsRatio =
    (message.replace(/[^A-Z]/g, "").length / message.length) * 100;
  if (capsRatio > 70 && message.length > 10) {
    return true;
  }

  if (/(.)\1{5,}/i.test(message)) {
    return true;
  }

  const linkCount = (message.match(/https?:\/\//gi) || []).length;
  if (linkCount > 2) {
    return true;
  }

  const keys = await getWordFilterCacheKeys();
  const recentKey = keys.recentMessages(streamId, userId);
  const recentMessages = await redisClient.lrange(recentKey, 0, 4);

  const duplicateCount = recentMessages.filter(
    (m) => m.toLowerCase() === message.toLowerCase()
  ).length;
  if (duplicateCount >= 2) {
    return true;
  }

  await redisClient.lpush(recentKey, message);
  await redisClient.ltrim(recentKey, 0, 4);
  await redisClient.expire(recentKey, 60);

  return false;
};

export const getBlockedWordCount = async (): Promise<number> => {
  const keys = await getWordFilterCacheKeys();
  return redisClient.scard(keys.blockedWords());
};

export const isWordBlocked = async (word: string): Promise<boolean> => {
  const keys = await getWordFilterCacheKeys();
  const result = await redisClient.sismember(
    keys.blockedWords(),
    word.toLowerCase()
  );
  return result === 1;
};

export const getAllBlockedWords = async (): Promise<string[]> => {
  const keys = await getWordFilterCacheKeys();
  return redisClient.smembers(keys.blockedWords());
};

export const getAllBlockedPatterns = async (): Promise<string[]> => {
  const keys = await getWordFilterCacheKeys();
  return redisClient.smembers(keys.blockedPatterns());
};
