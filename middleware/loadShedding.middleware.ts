import { Request, Response, NextFunction } from "express";
import { getSocketMetrics } from "@configs/socket.config";

const EXCLUDED_PATHS = ["/health", "/metrics", "/ready"];

export const loadSheddingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (EXCLUDED_PATHS.some((path) => req.path.startsWith(path))) {
    return next();
  }

  // Check memory usage for load shedding
  const memUsage = process.memoryUsage();
  const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  if (heapUsedPercent > 90) {
    res.setHeader("Retry-After", "5");
    return res.status(503).json({
      error: "Service temporarily unavailable",
      retryAfter: 5,
    });
  }

  next();
};

export const metricsHandler = (_req: Request, res: Response) => {
  const socketMetrics = getSocketMetrics();
  const memUsage = process.memoryUsage();

  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
    },
    socket: {
      connectedClients: socketMetrics.connectedSockets,
      queueLength: socketMetrics.queueLength,
    },
  });
};

export const readinessHandler = (_req: Request, res: Response) => {
  res.status(200).json({ status: "ready" });
};
