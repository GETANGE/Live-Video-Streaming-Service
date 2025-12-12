//  explicitly reference the type declaration
/// <reference path="../types/express.d.ts" /> 
import type{ Request, Response, NextFunction } from "express";
import { Redis } from "ioredis";

export const attachRedis = (redisClient: Redis) => {
  return (req: Request, res: Response, next: NextFunction) => {
    req.redisClient = redisClient;
    next();
  };
};