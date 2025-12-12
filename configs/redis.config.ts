import { Redis } from "ioredis";
import dotenv from "dotenv";
import logger from "@utils/logger";

dotenv.config();

const redisUrl =
    process.env.NODE_ENV === "production"
        ? process.env.REDIS_URL_PROD
        : process.env.REDIS_URL_DEV;

const redisClient = new Redis(redisUrl as string);


redisClient.on("error", (error) => {
  logger.warn(`Error connecting to redis`, error);
});

redisClient.on("connect", () => {
  logger.info(`🍃 Redis connected successfully`);
});

export default redisClient;