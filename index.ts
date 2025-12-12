import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import morgan from "morgan";
import cors from "cors";
import redisClient from "@configs/redis.config"
import rateLimit from "express-rate-limit";
import { RateLimiterMemory } from "rate-limiter-flexible";
import RedisStore from "rate-limit-redis";
import logger from "@utils/logger";
import { connectToDatabase } from "@configs/database.config";
import { corsOptions } from "@configs/cors.config";

import APIError from "@utils/APIError";
import ErrorHandlers from "@middleware/error.middleware";
import { attachRedis } from "@middleware/attatchRedis";
import { initSocket } from "@configs/socket.config";

dotenv.config();

const app = express();
const PORT = Number(process.env.AUTH_PORT) || 3006;

app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));
app.use(cors(corsOptions));

const rateLimiter = new RateLimiterMemory({
  keyPrefix: "global",
  points: 10,
  duration: 1, // 10 requests per second
});

app.use((req: any, res: Response, next: NextFunction) => {
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

// apply only to sensitive routes
app.use(SensitiveEndpointRatelimit as any);

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

app.use("/api/v1/auth", attachRedis(redisClient));

app.use((req: Request, res: Response, next: NextFunction) => {
  next(new APIError(`Route ${req.originalUrl} not found`, 404));
});

app.use(ErrorHandlers);

// Initialize WebSocket
const server = app.listen(PORT, () => {
  logger.info(`📽️ Live-Video-Streaming-Service server running at port ${PORT}`);
});

initSocket(server);

async function startServer() {
  try {
    await connectToDatabase();

    logger.info(`📽️ Live-Video-Streaming-Service fully initialized on port ${PORT}`);
  } catch (error: any) {
    logger.error("🔥 Failed to initialize Live-Video-Streaming-Service:", error);
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

process.on("SIGINT", () => {
  logger.info("SIGINT signal received");
  process.exit(0);
});

startServer();