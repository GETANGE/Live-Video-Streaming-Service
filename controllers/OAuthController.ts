import { PRIORITY } from "@constants/constant";
import { publishMessage } from "@events/producers/streaming.publisher";
import {
  getUserByEmailRepo,
  getUserByIdRepo,
} from "@repository/users.repository";
import {
  getUserCacheKeys,
  invalidateUserCache,
} from "@helpers/cacheInvalidations/userCacheInvalidate";
import { invalidateChannelCache } from "@helpers/cacheInvalidations/channelCacheInvalidation";
import redisClient from "@configs/redis.config";
import APIError from "@utils/APIError";
import logger from "@utils/logger";
import type { NextFunction, Request, Response } from "express";
import {
  generateRefreshToken,
  generateToken,
  verifyToken,
} from "helpers/generate-token.helper";
import passport from "passport";

const USER_CACHE_TTL = 60;

export const googleCallback = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  passport.authenticate(
    "google",
    { session: false },
    async (err: Error, user: any, info: any) => {
      const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3002";

      try {
        if (err) {
          // Redirect to frontend with error
          return res.redirect(
            `${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(err.message || "Google auth failed")}`,
          );
        }

        if (!user) {
          return res.redirect(
            `${FRONTEND_URL}/auth/callback?error=Authentication failed`,
          );
        }

        const accessToken = await generateToken(user);
        const refreshToken = await generateRefreshToken(user);

        // Redirect to frontend with tokens
        return res.redirect(
          `${FRONTEND_URL}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`,
        );
      } catch (error: any) {
        logger.error(error.message || "Failed to authenticate with Google");
        return res.redirect(
          `${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(error.message || "Authentication failed")}`,
        );
      }
    },
  )(req, res, next);
};

export const protectRoute = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return next(new APIError("Unauthorized", 401));
    }

    const decoded = await verifyToken(token);

    if (!decoded) {
      return next(new APIError("Unauthorized", 401));
    }

    const cacheKeys = await getUserCacheKeys();
    const cacheKey = cacheKeys.byId(decoded.id);
    let user = null;

    // Try to get user from Redis cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      user = JSON.parse(cached);
    }

    // If not in cache, fetch from database and cache it
    if (!user) {
      user = await getUserByIdRepo(decoded.id);

      if (!user) {
        return next(new APIError("User not found", 404));
      }

      await redisClient.set(cacheKey, JSON.stringify(user), "EX", USER_CACHE_TTL);
    }

    req.user = user;

    next();
  } catch (error: any) {
    logger.error(error.message || "Failed to protect route");
    return next(new APIError(error.message || "Failed to protect route", 500));
  }
};

export const restrictToAdmin = () => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const user = req.user;

      if (!user) {
        return next(new APIError("Unauthorized: no user found", 401));
      }

      if (!user.isAdmin) {
        return next(new APIError("Forbidden: admin access required", 403));
      }

      next();
    } catch (error: any) {
      logger.error(error.message || "Failed to restrict access");
      return next(
        new APIError(error.message || "Failed to restrict access", 500),
      );
    }
  };
};

export const getCurrentUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user;

    if (!user) {
      return next(new APIError("User not found", 404));
    }

    res.status(200).json({
      status: "success",
      data: user,
    });
  } catch (error: any) {
    logger.error(error.message || "Failed to get current user");
    return next(new APIError("Internal server error", 500));
  }
};

export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, username, phoneNumber } = req.body;

    if (!email) {
      return next(new APIError("Email is required", 400));
    }

    const user = await getUserByEmailRepo(email);

    if (!user) {
      return next(new APIError("User not found", 404));
    }

    const message = {
      eventType: "USER_PROFILE_UPDATE",
      priority: PRIORITY.MEDIUM,
      payload: {
        id: user.id,
        email,
        username,
        phoneNumber,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);
    await invalidateUserCache();
    await invalidateChannelCache();

    res.status(202).json({
      status: "success",
      message: "Profile update queued successfully",
    });
  } catch (error: any) {
    logger.error("Update profile failed", error);
    return next(new APIError("Internal server error", 500));
  }
};
