import CircuitBreaker from "opossum";
import logger from "./logger";

interface CircuitBreakerConfig {
  name: string;
  timeout?: number; // Time in ms before a call is considered failed
  errorThresholdPercentage?: number; // Error percentage to trip the circuit
  resetTimeout?: number; // Time in ms to wait before trying again
  volumeThreshold?: number; // Minimum requests before tripping
}

const defaultConfig = {
  timeout: 10000, // 10 seconds
  errorThresholdPercentage: 50, // Trip if 50% of requests fail
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 5, // Need at least 5 requests before tripping
};

export const createCircuitBreaker = <T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: CircuitBreakerConfig,
): CircuitBreaker<any[], any> => {
  const options = {
    timeout: config.timeout ?? defaultConfig.timeout,
    errorThresholdPercentage: config.errorThresholdPercentage ?? defaultConfig.errorThresholdPercentage,
    resetTimeout: config.resetTimeout ?? defaultConfig.resetTimeout,
    volumeThreshold: config.volumeThreshold ?? defaultConfig.volumeThreshold,
  };

  const breaker = new CircuitBreaker(fn, options);

  // Logging events
  breaker.on("open", () => {
    logger.warn(`Circuit OPEN: ${config.name} - requests will fail fast`);
  });

  breaker.on("halfOpen", () => {
    logger.info(`Circuit HALF-OPEN: ${config.name} - testing if service recovered`);
  });

  breaker.on("close", () => {
    logger.info(`Circuit CLOSED: ${config.name} - service recovered`);
  });

  breaker.on("fallback", () => {
    logger.warn(`Circuit FALLBACK: ${config.name} - using fallback`);
  });

  breaker.on("timeout", () => {
    logger.warn(`Circuit TIMEOUT: ${config.name} - request timed out`);
  });

  return breaker;
};

// Circuit breaker stats for monitoring
export const getCircuitStats = (breaker: CircuitBreaker<any, any>) => ({
  state: breaker.opened ? "open" : breaker.halfOpen ? "half-open" : "closed",
  stats: {
    successes: breaker.stats.successes,
    failures: breaker.stats.failures,
    timeouts: breaker.stats.timeouts,
    fallbacks: breaker.stats.fallbacks,
    rejects: breaker.stats.rejects,
  },
});
