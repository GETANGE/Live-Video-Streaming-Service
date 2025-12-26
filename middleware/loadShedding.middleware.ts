import { Request, Response, NextFunction } from "express";
import { getSocketMetrics } from "@configs/socket.config";
import { getCDNCircuitStats } from "@services/cdn.service";
import { getMpesaCircuitStats } from "api/mpesa.api";
import { getMinioCircuitStats } from "@helpers/hls.helper-functions";
import { getQueueMetrics } from "@events/consumers/streaming.consumer";
import {
  register,
  websocketConnectionsGauge,
  circuitBreakerState,
  queueMessagesGauge,
  httpRequestsTotal,
  httpRequestDuration,
} from "@configs/metrics.config";

const EXCLUDED_PATHS = ["/health", "/metrics", "/ready"];

// Configurable thresholds (in MB)
const MAX_HEAP_MB = parseInt(process.env.MAX_HEAP_MB || "512", 10);
const MAX_RSS_MB = parseInt(process.env.MAX_RSS_MB || "1024", 10);

// HTTP Metrics Middleware - tracks request counts and durations
export const httpMetricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Skip metrics endpoints to avoid recursion
  if (EXCLUDED_PATHS.some((path) => req.path.startsWith(path))) {
    return next();
  }

  const startTime = Date.now();
  const instance = process.env.INSTANCE_ID || "unknown";

  // Normalize route for metrics (avoid high cardinality)
  const getRoutePattern = (req: Request): string => {
    // Use the matched route pattern if available
    if (req.route?.path) {
      return req.baseUrl + req.route.path;
    }
    // Fallback: normalize dynamic segments
    const path = req.path
      .replace(/\/[0-9a-fA-F-]{36}/g, "/:id") // UUIDs
      .replace(/\/\d+/g, "/:id"); // Numeric IDs
    return path || "/";
  };

  // Capture response on finish
  res.on("finish", () => {
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    const route = getRoutePattern(req);
    const method = req.method;
    const statusCode = res.statusCode.toString();

    // Increment request counter
    httpRequestsTotal.inc({
      method,
      route,
      status_code: statusCode,
      instance,
    });

    // Record request duration
    httpRequestDuration.observe(
      {
        method,
        route,
        status_code: statusCode,
        instance,
      },
      duration,
    );
  });

  next();
};

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

export const metricsHandler = async (_req: Request, res: Response) => {
  const instance = process.env.INSTANCE_ID || "unknown";

  // Update WebSocket metrics
  const socketMetrics = getSocketMetrics();
  websocketConnectionsGauge.set({ instance }, socketMetrics.connectedSockets);

  // Update queue metrics
  const queueMetrics = getQueueMetrics();
  if (queueMetrics.video?.activeJobs !== undefined) {
    queueMessagesGauge.set({ queue: "video_active", instance }, queueMetrics.video.activeJobs);
  }
  if (queueMetrics.general?.processedCount !== undefined) {
    queueMessagesGauge.set({ queue: "general_processed", instance }, queueMetrics.general.processedCount);
  }

  // Update circuit breaker metrics
  const cdnStats = getCDNCircuitStats();
  const mpesaStats = getMpesaCircuitStats();
  const minioStats = getMinioCircuitStats();

  const getCircuitState = (stats: any): number => {
    if (!stats) return 0;
    if (stats.state === "open") return 1;
    if (stats.state === "half-open") return 0.5;
    return 0; // closed
  };

  if (cdnStats?.imageUpload) {
    circuitBreakerState.set({ service: "cloudinary_image", instance }, getCircuitState(cdnStats.imageUpload));
  }
  if (mpesaStats?.auth) {
    circuitBreakerState.set({ service: "mpesa_auth", instance }, getCircuitState(mpesaStats.auth));
  }
  if (minioStats?.upload) {
    circuitBreakerState.set({ service: "minio_upload", instance }, getCircuitState(minioStats.upload));
  }

  // Return Prometheus format
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
};

// JSON metrics endpoint for debugging (optional)
export const metricsJsonHandler = (_req: Request, res: Response) => {
  const socketMetrics = getSocketMetrics();
  const memUsage = process.memoryUsage();

  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    instance: process.env.INSTANCE_ID || "unknown",
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
    },
    queues: getQueueMetrics(),
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
