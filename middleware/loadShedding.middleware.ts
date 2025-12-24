import { Request, Response, NextFunction } from "express";
import { getSocketMetrics } from "@configs/socket.config";
import { getCDNCircuitStats } from "@services/cdn.service";
import { getMpesaCircuitStats } from "api/mpesa.api";
import { getMinioCircuitStats } from "@helpers/hls.helper-functions";

const EXCLUDED_PATHS = ["/health", "/metrics", "/ready"];

// Configurable thresholds (in MB)
const MAX_HEAP_MB = parseInt(process.env.MAX_HEAP_MB || "512", 10);
const MAX_RSS_MB = parseInt(process.env.MAX_RSS_MB || "1024", 10);

export const loadSheddingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (EXCLUDED_PATHS.some((path) => req.path.startsWith(path))) {
    return next();
  }

  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const rssMB = memUsage.rss / 1024 / 1024;

  // Shed load if absolute memory thresholds exceeded
  if (heapUsedMB > MAX_HEAP_MB || rssMB > MAX_RSS_MB) {
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
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB",
      thresholds: {
        maxHeap: MAX_HEAP_MB + "MB",
        maxRss: MAX_RSS_MB + "MB",
      },
    },
    socket: {
      connectedClients: socketMetrics.connectedSockets,
      queueLength: socketMetrics.queueLength,
    },
    circuitBreakers: {
      cloudinary: getCDNCircuitStats(),
      mpesa: getMpesaCircuitStats(),
      minio: getMinioCircuitStats(),
    },
  });
};

export const readinessHandler = (_req: Request, res: Response) => {
  res.status(200).json({ status: "ready" });
};
