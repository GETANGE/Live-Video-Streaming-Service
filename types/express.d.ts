import { Redis } from "ioredis";

declare global {
  namespace Express {
    interface Request {
      redisClient: Redis;
    }
  }
}

export interface TokenPayload {
  id: string;
  email: string;
}

export {};