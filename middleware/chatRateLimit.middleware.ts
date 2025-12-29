import { RateLimiterRedis } from "rate-limiter-flexible";
import redisClient from "@configs/redis.config";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

// Chat rate limiter: 5 messages per 10 seconds per user per stream
const chatRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "chat_rate",
  points: 5, // Number of messages
  duration: 10, // Per 10 seconds
  blockDuration: 30, // Block for 30 seconds if exceeded
});

// Slow mode rate limiter: 1 message per X seconds (configurable per stream)
const slowModeRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "chat_slow",
  points: 1,
  duration: 3, // Default 3 second slow mode
});

// Typing indicator rate limiter
const typingRateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: "chat_typing",
  points: 3,
  duration: 5,
});

// Check chat rate limit
export const checkChatRateLimit = async (
  userId: string,
  streamId: string
): Promise<void> => {
  const key = `${userId}:${streamId}`;

  try {
    await chatRateLimiter.consume(key);
  } catch (rateLimiterRes: any) {
    const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000) || 30;
    logger.warn(
      `Chat rate limit exceeded: user ${userId} in stream ${streamId}`
    );
    throw new APIError(
      `Too many messages. Please wait ${retryAfter} seconds.`,
      429
    );
  }
};

// Check slow mode rate limit
export const checkSlowModeRateLimit = async (
  userId: string,
  streamId: string,
  slowModeDuration?: number
): Promise<void> => {
  // If no slow mode set, skip
  if (!slowModeDuration || slowModeDuration <= 0) {
    return;
  }

  const key = `slow:${userId}:${streamId}`;

  // Create a custom limiter with the specific duration
  const customSlowMode = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: "chat_slow_custom",
    points: 1,
    duration: slowModeDuration,
  });

  try {
    await customSlowMode.consume(key);
  } catch (rateLimiterRes: any) {
    const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000) || slowModeDuration;
    throw new APIError(
      `Slow mode enabled. Wait ${retryAfter} seconds before sending another message.`,
      429
    );
  }
};

// Check typing indicator rate limit
export const checkTypingRateLimit = async (
  userId: string,
  streamId: string
): Promise<boolean> => {
  const key = `typing:${userId}:${streamId}`;

  try {
    await typingRateLimiter.consume(key);
    return true;
  } catch {
    // Silently ignore typing rate limit (just don't send indicator)
    return false;
  }
};

// Get remaining messages for user
export const getRemainingMessages = async (
  userId: string,
  streamId: string
): Promise<{ remaining: number; resetIn: number }> => {
  const key = `${userId}:${streamId}`;

  try {
    const result = await chatRateLimiter.get(key);

    if (!result) {
      return { remaining: 5, resetIn: 0 };
    }

    return {
      remaining: Math.max(0, 5 - result.consumedPoints),
      resetIn: Math.ceil(result.msBeforeNext / 1000),
    };
  } catch {
    return { remaining: 5, resetIn: 0 };
  }
};

// Reset rate limit for a user (mod action)
export const resetChatRateLimit = async (
  userId: string,
  streamId: string
): Promise<void> => {
  const key = `${userId}:${streamId}`;
  await chatRateLimiter.delete(key);
};

// Block a user from chat temporarily
export const blockUserTemporarily = async (
  userId: string,
  streamId: string,
  durationSeconds: number
): Promise<void> => {
  const key = `${userId}:${streamId}`;

  // Consume all points and set block duration
  await chatRateLimiter.block(key, durationSeconds);

  logger.info(
    `User ${userId} blocked from chat in stream ${streamId} for ${durationSeconds}s`
  );
};

// Check if user is blocked
export const isUserBlocked = async (
  userId: string,
  streamId: string
): Promise<boolean> => {
  const key = `${userId}:${streamId}`;

  try {
    const result = await chatRateLimiter.get(key);
    return result !== null && result.remainingPoints <= 0;
  } catch {
    return false;
  }
};
