import { Request, Response, NextFunction } from "express";
import {
  isDatabaseUnderBackpressure,
  getDatabaseMetrics,
} from "@configs/database.config";
import { getSocketMetrics } from "@configs/socket.config";
import logger from "@utils/logger";

const EXCLUDED_PATHS = ["/health", "/metrics", "/ready"];
const RETRY_AFTER_SECONDS = 5;

export const loadSheddingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (EXCLUDED_PATHS.some((path) => req.path.startsWith(path))) {
    return next();
  }

  if (isDatabaseUnderBackpressure()) {
    logger.warn(`Load shedding: Rejecting ${req.method} ${req.path}`);

    res.setHeader("Retry-After", RETRY_AFTER_SECONDS);
    return res.status(503).json({
      error: "Service temporarily unavailable",
      retryAfter: RETRY_AFTER_SECONDS,
    });
  }

  next();
};

export const metricsHandler = (_req: Request, res: Response) => {
  const dbMetrics = getDatabaseMetrics();
  const socketMetrics = getSocketMetrics();
  const healthy = !dbMetrics.isUnderPressure;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    database: {
      activeQueries: dbMetrics.activeQueries,
      maxConcurrent: dbMetrics.maxConcurrentQueries,
    },
    socket: {
      connectedClients: socketMetrics.connectedSockets,
      queueLength: socketMetrics.queueLength,
    },
  });
};

export const readinessHandler = (_req: Request, res: Response) => {
  const healthy = !isDatabaseUnderBackpressure();

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ready" : "not_ready",
  });
};
