import { Request, Response, NextFunction } from "express";
import {
  isDatabaseUnderBackpressure,
  getDatabaseMetrics,
} from "@configs/database.config";
import { getPublisherMetrics } from "@events/producers/streaming.publisher";
import { getBackpressureMetrics } from "@events/consumers/streaming.consumer";
import { getSocketMetrics } from "@configs/socket.config";
import logger from "@utils/logger";
import { SystemHealth } from "@types";

// Load shedding configuration
const LOAD_SHEDDING_CONFIG = {
  enabled: process.env.LOAD_SHEDDING_ENABLED == "true",
  // Percentage of requests to shed when under pressure (0-100)
  shedPercentage: parseInt(process.env.LOAD_SHED_PERCENTAGE || "50", 10),
  // Retry-After header value in seconds
  retryAfterSeconds: parseInt(process.env.LOAD_SHED_RETRY_AFTER || "5", 10),
  // Paths that should never be shed (health checks, critical endpoints)
  excludedPaths: ["/health", "/metrics", "/ready"],
};


// Get current system health
export const getSystemHealth = (): SystemHealth => {
  const dbMetrics = getDatabaseMetrics();
  const publisherMetrics = getPublisherMetrics();
  const consumerMetrics = getBackpressureMetrics();
  const socketMetrics = getSocketMetrics();

  const dbHealthy = !dbMetrics.isUnderPressure;
  const publisherHealthy = !publisherMetrics.isBlocked;
  const consumerHealthy = !consumerMetrics.isPaused;
  const socketHealthy =
    socketMetrics.queueLength < socketMetrics.queueLimit * 0.9;

  return {
    database: { healthy: dbHealthy, metrics: dbMetrics },
    publisher: { healthy: publisherHealthy, metrics: publisherMetrics },
    consumer: { healthy: consumerHealthy, metrics: consumerMetrics },
    socket: { healthy: socketHealthy, metrics: socketMetrics },
    overall: dbHealthy && publisherHealthy && consumerHealthy && socketHealthy,
  };
};

// Determine if we should shed this request
const shouldShedRequest = (health: SystemHealth): boolean => {
  if (health.overall) return false;

  // Count how many systems are unhealthy
  const unhealthyCount = [
    health.database.healthy,
    health.publisher.healthy,
    health.consumer.healthy,
    health.socket.healthy,
  ].filter((h) => !h).length;

  // More aggressive shedding when more systems are unhealthy
  const shedProbability =
    (unhealthyCount / 4) * (LOAD_SHEDDING_CONFIG.shedPercentage / 100);

  return Math.random() < shedProbability;
};

// Load shedding middleware
export const loadSheddingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Skip if disabled
  if (!LOAD_SHEDDING_CONFIG.enabled) {
    return next();
  }

  // Skip excluded paths
  if (
    LOAD_SHEDDING_CONFIG.excludedPaths.some((path) => req.path.startsWith(path))
  ) {
    return next();
  }

  const health = getSystemHealth();

  // If system is healthy, proceed
  if (health.overall) {
    return next();
  }

  // Determine if this request should be shed
  if (shouldShedRequest(health)) {
    const unhealthySystems: string[] = [];
    if (!health.database.healthy) unhealthySystems.push("database");
    if (!health.publisher.healthy) unhealthySystems.push("publisher");
    if (!health.consumer.healthy) unhealthySystems.push("consumer");
    if (!health.socket.healthy) unhealthySystems.push("socket");

    logger.warn(
      `🚫 Load shedding: Rejecting ${req.method} ${req.path} | Unhealthy: ${unhealthySystems.join(", ")}`,
    );

    res.setHeader("Retry-After", LOAD_SHEDDING_CONFIG.retryAfterSeconds);
    return res.status(503).json({
      status: "error",
      error: "Service temporarily unavailable",
      message: "Server is under heavy load. Please retry shortly.",
      retryAfter: LOAD_SHEDDING_CONFIG.retryAfterSeconds,
    });
  }

  // Allow request but log warning
  logger.debug(
    `⚠️ System under pressure but allowing ${req.method} ${req.path}`,
  );

  next();
};

// Strict load shedding - rejects ALL requests when system is unhealthy
export const strictLoadSheddingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!LOAD_SHEDDING_CONFIG.enabled) {
    return next();
  }

  if (
    LOAD_SHEDDING_CONFIG.excludedPaths.some((path) => req.path.startsWith(path))
  ) {
    return next();
  }

  if (isDatabaseUnderBackpressure()) {
    logger.warn(
      `🚫 Strict load shedding: Database under pressure - rejecting ${req.method} ${req.path}`,
    );

    res.setHeader("Retry-After", LOAD_SHEDDING_CONFIG.retryAfterSeconds);
    return res.status(503).json({
      status: "error",
      error: "Service temporarily unavailable",
      message: "Database is under heavy load. Please retry shortly.",
      retryAfter: LOAD_SHEDDING_CONFIG.retryAfterSeconds,
    });
  }

  next();
};

// Metrics endpoint handler
export const metricsHandler = (req: Request, res: Response) => {
  const health = getSystemHealth();

  res.status(health.overall ? 200 : 503).json({
    status: health.overall ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    systems: {
      database: {
        status: health.database.healthy ? "healthy" : "pressured",
        activeQueries: health.database.metrics.activeQueries,
        maxConcurrent: health.database.metrics.maxConcurrentQueries,
        pendingQueries: health.database.metrics.pendingQueries,
      },
      publisher: {
        status: health.publisher.healthy ? "healthy" : "blocked",
        pendingMessages: health.publisher.metrics.pendingCount,
        bufferLimit: health.publisher.metrics.bufferLimit,
      },
      consumer: {
        status: health.consumer.healthy ? "healthy" : "paused",
        inFlight: health.consumer.metrics.inFlightCount,
        threshold: health.consumer.metrics.threshold,
      },
      socket: {
        status: health.socket.healthy ? "healthy" : "congested",
        queueLength: health.socket.metrics.queueLength,
        queueLimit: health.socket.metrics.queueLimit,
        connectedClients: health.socket.metrics.connectedSockets,
      },
    },
    loadShedding: {
      enabled: LOAD_SHEDDING_CONFIG.enabled,
      shedPercentage: LOAD_SHEDDING_CONFIG.shedPercentage,
    },
  });
};

// Readiness probe - returns 503 if system can't accept traffic
export const readinessHandler = (req: Request, res: Response) => {
  const health = getSystemHealth();

  if (health.overall) {
    return res.status(200).json({ status: "ready" });
  }

  res.status(503).json({
    status: "not_ready",
    reason: "System under backpressure",
  });
};
