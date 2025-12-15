import { PRIORITY } from "@constants/constant";
import { publishMessage } from "@events/producers/streaming.publisher";
import {
  getUserByEmailRepo,
  getUserByIdRepo,
} from "@repository/users.repository";
import APIError from "@utils/APIError";
import logger from "@utils/logger";
import type { NextFunction, Request, Response } from "express";
import {
  generateRefreshToken,
  generateToken,
  verifyToken,
} from "helpers/generate-token.helper";
import passport from "passport";

export const googleCallback = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  passport.authenticate(
    "google",
    { session: false },
    async (err: Error, user: any, info: any) => {
      try {
        if (err) {
          return next(new APIError(err.message || "Google auth failed", 500));
        }

        if (!user) {
          return next(new APIError("Authentication failed", 401));
        }

        const accessToken = await generateToken(user);
        const refreshToken = await generateRefreshToken(user);

        return res.status(200).json({
          status: "success",
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            imageUrl: user.imageUrl,
            isActive: user.isActive,
            isAdmin: user.isAdmin,
          },
        });
      } catch (error: any) {
        logger.error(error.message || "Failed to update profile");
        return next(
          new APIError(error.message || "Failed to update profile", 500),
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

    const user = await getUserByIdRepo(decoded.id);

    if (!user) {
      return next(new APIError("User not found", 404));
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

    res.status(202).json({
      status: "success",
      message: "Profile update queued successfully",
    });
  } catch (error: any) {
    logger.error("Update profile failed", error);
    return next(new APIError("Internal server error", 500));
  }
};
