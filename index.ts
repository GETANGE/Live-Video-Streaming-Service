import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import morgan from "morgan";
import passport from "passport";
import cors from "cors";
import redisClient from "@configs/redis.config";
import rateLimit from "express-rate-limit";
import { RateLimiterMemory } from "rate-limiter-flexible";
import RedisStore from "rate-limit-redis";
import logger from "@utils/logger";
import { connectToDatabase } from "@configs/database.config";
import { corsOptions } from "@configs/cors.config";

import APIError from "@utils/APIError";
import ErrorHandlers from "@middleware/error.middleware";
import {
  loadSheddingMiddleware,
  metricsHandler,
  readinessHandler,
  httpMetricsMiddleware,
} from "@middleware/loadShedding.middleware";

import authRoutes from "@routes/user.route";
import subscriptionRoutes from "@routes/subscription.route";
import notificationRoutes from "@routes/notification.route";
import paymentRoutes from "@routes/payment.route";
import uploadRoutes from "@routes/upload.route";
import channelRoutes from "@routes/channel.route";
import livestreamRoutes from "@routes/livestream.route";
import streamKeyRoutes from "@routes/streamkey.route";
import chatRoutes from "@routes/chat.route";
import browserStreamRoutes from "@routes/browser-stream.route";
import { attachRedis } from "@middleware/attatchRedis";
import { initRtmpServer, stopRtmpServer } from "@configs/rtmp.config";
import { initMinio } from "@configs/minio.config";
import { initSocket } from "@configs/socket.config";
import { initLiveSocket } from "@configs/socket-live.config";
import { connectToRabbitMq } from "@configs/rabbitMQ.config";
import { consumeMessage } from "@events/consumers/streaming.consumer";
import { consumeLiveQueue } from "@events/consumers/live.consumer";
import { googleStrategy } from "@services/user.service";
import { startAllJobs, stopAllJobs } from "@jobs/index";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 8040;

// Trust proxy - required when behind nginx/load balancer
// This allows express-rate-limit to correctly identify clients via X-Forwarded-For
app.set("trust proxy", 1);

googleStrategy();

app.use(helmet());
app.use(express.json());
app.use(passport.initialize());
app.use(morgan("dev"));
app.use(cors(corsOptions));

const rateLimiter = new RateLimiterMemory({
  keyPrefix: "global",
  points: 10,
  duration: 1, // 10 requests per second
});

app.use((req: any, res: Response, next: NextFunction) => {
  // Skip rate limiting for health checks and metrics (Prometheus scraping)
  if (req.path === "/health" || req.path === "/metrics" || req.path === "/ready") {
    return next();
  }
  rateLimiter
    .consume(req.ip)
    .then(() => next())
    .catch(() => {
      logger.warn(`⚠️ Global rate limit exceeded for IP: ${req.ip}`);
      next(new APIError("Too many requests", 429));
    });
});

const SensitiveEndpointRatelimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    // Skip rate limiting for health checks and metrics (Prometheus scraping)
    return req.path === "/health" || req.path === "/metrics" || req.path === "/ready";
  },
  handler: (req: Request, res: Response, next: NextFunction) => {
    logger.warn(`⛔ Sensitive endpoint limit exceeded | IP: ${req.ip}`);
    next(new APIError("Too many requests", 429));
  },
  store: new RedisStore({
    sendCommand: (...args: [string, ...string[]]): Promise<any> => {
      return redisClient.call(...args);
    },
  }),
});

app.use(SensitiveEndpointRatelimit as any);

// Load shedding middleware - rejects requests when system is overloaded
app.use(loadSheddingMiddleware);

// HTTP metrics middleware - tracks request counts and durations for Prometheus
app.use(httpMetricsMiddleware);

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "success",
    message: "Live-Video-Streaming-Service health-check",
    data: {
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV,
    },
  });
});

// System metrics endpoint - shows backpressure status
app.get("/metrics", metricsHandler);

// Kubernetes readiness probe
app.get("/ready", readinessHandler);

app.use("/api/v1/auth", attachRedis(redisClient), authRoutes);
app.use("/api/v1/subscriptions", attachRedis(redisClient), subscriptionRoutes);
app.use("/api/v1/notifications", attachRedis(redisClient), notificationRoutes);
app.use("/api/v1/payments", attachRedis(redisClient), paymentRoutes);
app.use("/api/v1/uploads", attachRedis(redisClient), uploadRoutes);
app.use("/api/v1/channels", attachRedis(redisClient), channelRoutes);

// Livestreaming routes
app.use("/api/v1/livestreams", attachRedis(redisClient), livestreamRoutes);
app.use("/api/v1/stream-keys", attachRedis(redisClient), streamKeyRoutes);
app.use("/api/v1/chat", attachRedis(redisClient), chatRoutes);
app.use("/api/v1/browser-stream", browserStreamRoutes);


app.use((req: Request, res: Response, next: NextFunction) => {
  next(new APIError(`Route ${req.originalUrl} not found`, 404));
});

app.use(ErrorHandlers);

// Initialize HTTP Server
const server = app.listen(PORT, () => {
  logger.info(`Live-Video-Streaming-Service server running at port ${PORT}`);
});

async function startServer() {
  try {
    // Initialize Socket.IO with Redis adapter
    const io = await initSocket(server);
    initLiveSocket(io);

    await connectToDatabase();
    await connectToRabbitMq();

    // Start message consumers
    await consumeMessage();
    await consumeLiveQueue();

    await initMinio();

    // Start background jobs (CDN sync, chat cleanup)
    startAllJobs();

    // Initialize RTMP server
    initRtmpServer();

    logger.info(
      `Live-Video-Streaming-Service fully initialized on port ${PORT}`,
    );
  } catch (error: any) {
    logger.error(
      "Failed to initialize Live-Video-Streaming-Service:",
      error,
    );
    process.exit(1);
  }
}

// Handle uncaught exceptions/rejections
process.on("uncaughtException", (err) => {
  logger.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  logger.error("❌ Unhandled Promise Rejection:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT signal received");
  stopAllJobs();
  await stopRtmpServer();
  process.exit(0);
});

startServer();
