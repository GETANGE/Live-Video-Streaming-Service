import logger from "@utils/logger";

export const BACKOFF_CONFIG = {
  INITIAL_DELAY_MS: 100,
  MAX_DELAY_MS: 30000,
  MAX_RETRIES: 3,
} as const;


// Sleep for a specified duration
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};


// Calculate exponential backoff delay with jitter
export const calculateBackoff = (
  retryCount: number,
  initialDelayMs: number = BACKOFF_CONFIG.INITIAL_DELAY_MS,
  maxDelayMs: number = BACKOFF_CONFIG.MAX_DELAY_MS
): number => {
  const delay = initialDelayMs * Math.pow(2, retryCount);
  const jitter = Math.random() * delay * 0.1;
  return Math.min(delay + jitter, maxDelayMs);
};


// Execute a function with automatic retry and exponential backoff
export const withRetry = async(
  fn: () => Promise<void>,
  maxRetries: number = BACKOFF_CONFIG.MAX_RETRIES
): Promise<void> => {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt >= maxRetries) {
        throw lastError;
      }

      const delay = calculateBackoff(attempt);
      logger.warn(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${lastError.message}`);
      await sleep(delay);
    }
  }

  throw lastError!;
};
