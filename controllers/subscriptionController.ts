import { Request, Response, NextFunction } from "express";
import * as subscriptionService from "@services/subscription.service";
import { publishMessage } from "@events/producers/streaming.publisher";
import { PRIORITY } from "@constants/constant";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

// Subscribe to a channel - publishes to queue
export const subscribe = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    const { channelId } = req.params;
    const { endDate } = req.body;

    if (!userId) {
      return next(new APIError("Unauthorized", 401));
    }

    if (!channelId) {
      return next(new APIError("Channel ID is required", 400));
    }

    const message = {
      eventType: "SUBSCRIPTION_CREATED",
      priority: PRIORITY.HIGH,
      payload: {
        userId,
        channelId,
        endDate: endDate ? new Date(endDate).toISOString() : null,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({
      status: "success",
      message: "Subscription request received and will be processed",
    });
  } catch (error: any) {
    logger.error("Subscribe error:", error);
    next(error);
  }
};

// Unsubscribe from a channel - publishes to queue
export const unsubscribe = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    const { channelId } = req.params;

    if (!userId) {
      return next(new APIError("Unauthorized", 401));
    }

    if (!channelId) {
      return next(new APIError("Channel ID is required", 400));
    }

    const message = {
      eventType: "SUBSCRIPTION_CANCELLED",
      priority: PRIORITY.MEDIUM,
      payload: {
        userId,
        channelId,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({
      status: "success",
      message: "Unsubscribe request received and will be processed",
    });
  } catch (error: any) {
    logger.error("Unsubscribe error:", error);
    next(error);
  }
};

// Get current user's subscriptions
export const getMySubscriptions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    const { page = 1, limit = 20, active } = req.query;

    if (!userId) {
      return next(new APIError("Unauthorized", 401));
    }

    const params = {
      page: parseInt(page as string, 10),
      limit: Math.min(parseInt(limit as string, 10), 100), // Max 100 per page
    };

    const subscriptions =
      active === "true"
        ? await subscriptionService.getActiveSubscriptionsByUser(userId, params)
        : await subscriptionService.getSubscriptionsByUser(userId, params);

    res.status(200).json({
      status: "success",
      ...subscriptions,
    });
  } catch (error: any) {
    logger.error("Get subscriptions error:", error);
    next(error);
  }
};

// Check if subscribed to a channel
export const checkSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    const { channelId } = req.params;

    if (!userId) {
      return next(new APIError("Unauthorized", 401));
    }

    if (!channelId) {
      return next(new APIError("Channel ID is required", 400));
    }

    const isSubscribed = await subscriptionService.isSubscribed(
      userId,
      channelId,
    );

    res.status(200).json({
      status: "success",
      data: { isSubscribed },
    });
  } catch (error: any) {
    logger.error("Check subscription error:", error);
    next(error);
  }
};

// Batch check subscriptions (for UI optimization)
export const checkMultipleSubscriptions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    const { channelIds } = req.body;

    if (!userId) {
      return next(new APIError("Unauthorized", 401));
    }

    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return next(new APIError("channelIds array is required", 400));
    }

    if (channelIds.length > 50) {
      return next(new APIError("Maximum 50 channels per request", 400));
    }

    const subscriptions = await subscriptionService.checkMultipleSubscriptions(
      userId,
      channelIds,
    );

    res.status(200).json({
      status: "success",
      data: subscriptions,
    });
  } catch (error: any) {
    logger.error("Check multiple subscriptions error:", error);
    next(error);
  }
};

// Get channel subscribers (public or channel owner)
export const getChannelSubscribers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { channelId } = req.params;
    const { limit = 50, cursor } = req.query;

    if (!channelId) {
      return next(new APIError("Channel ID is required", 400));
    }

    const params = {
      limit: Math.min(parseInt(limit as string, 10), 100),
      cursor: cursor as string | undefined,
    };

    const subscribers = await subscriptionService.getChannelSubscribers(
      channelId,
      params,
    );

    res.status(200).json({
      status: "success",
      ...subscribers,
    });
  } catch (error: any) {
    logger.error("Get channel subscribers error:", error);
    next(error);
  }
};

// Get subscriber count for a channel
export const getSubscriberCount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { channelId } = req.params;

    if (!channelId) {
      return next(new APIError("Channel ID is required", 400));
    }

    const count = await subscriptionService.getSubscriberCount(channelId);

    res.status(200).json({
      status: "success",
      data: { channelId, subscriberCount: count },
    });
  } catch (error: any) {
    logger.error("Get subscriber count error:", error);
    next(error);
  }
};

// Batch get subscriber counts (for channel listings)
export const getMultipleSubscriberCounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { channelIds } = req.body;

    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return next(new APIError("channelIds array is required", 400));
    }

    if (channelIds.length > 100) {
      return next(new APIError("Maximum 100 channels per request", 400));
    }

    const counts =
      await subscriptionService.getMultipleSubscriberCounts(channelIds);

    // Convert Map to object for JSON response
    const countsObject: Record<string, number> = {};
    counts.forEach((count, channelId) => {
      countsObject[channelId] = count;
    });

    res.status(200).json({
      status: "success",
      data: countsObject,
    });
  } catch (error: any) {
    logger.error("Get multiple subscriber counts error:", error);
    next(error);
  }
};

// Get subscription by ID
export const getSubscriptionById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!id) {
      return next(new APIError("Subscription ID is required", 400));
    }

    const subscription = await subscriptionService.getSubscriptionById(id);

    if (!subscription) {
      return next(new APIError("Subscription not found", 404));
    }

    // Check if user owns this subscription or is admin
    if (subscription.userId !== req.user?.id && !req.user?.isAdmin) {
      return next(new APIError("Forbidden", 403));
    }

    res.status(200).json({
      status: "success",
      data: subscription,
    });
  } catch (error: any) {
    logger.error("Get subscription error:", error);
    next(error);
  }
};

// ============ ADMIN ENDPOINTS ============

// Get all subscriptions (admin only)
export const getAllSubscriptions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.isAdmin) {
      return next(new APIError("Forbidden: Admin access required", 403));
    }

    const { page = 1, limit = 50, status } = req.query;

    const params = {
      page: parseInt(page as string, 10),
      limit: Math.min(parseInt(limit as string, 10), 100),
    };

    const validStatuses = ["ACTIVE", "CANCELLED", "EXPIRED"];
    const statusFilter =
      status && validStatuses.includes(status as string)
        ? (status as "ACTIVE" | "CANCELLED" | "EXPIRED")
        : undefined;

    const subscriptions = await subscriptionService.getAllSubscriptions(
      params,
      statusFilter,
    );

    res.status(200).json({
      status: "success",
      ...subscriptions,
    });
  } catch (error: any) {
    logger.error("Get all subscriptions error:", error);
    next(error);
  }
};

// Get subscription stats (admin only)
export const getStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.isAdmin) {
      return next(new APIError("Forbidden: Admin access required", 403));
    }

    const stats = await subscriptionService.getStats();

    res.status(200).json({
      status: "success",
      data: stats,
    });
  } catch (error: any) {
    logger.error("Get stats error:", error);
    next(error);
  }
};

// Get top channels by subscribers (admin only)
export const getTopChannels = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.isAdmin) {
      return next(new APIError("Forbidden: Admin access required", 403));
    }

    const { limit = 10 } = req.query;
    const topChannels = await subscriptionService.getTopChannels(
      Math.min(parseInt(limit as string, 10), 50),
    );

    res.status(200).json({
      status: "success",
      data: topChannels,
    });
  } catch (error: any) {
    logger.error("Get top channels error:", error);
    next(error);
  }
};

// Process expired subscriptions (admin/cron) - publishes to queue
export const processExpired = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.isAdmin) {
      return next(new APIError("Forbidden: Admin access required", 403));
    }

    const message = {
      eventType: "SUBSCRIPTION_EXPIRED",
      priority: PRIORITY.LOW,
      payload: {
        triggeredBy: req.user.id,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({
      status: "success",
      message: "Expired subscriptions processing has been queued",
    });
  } catch (error: any) {
    logger.error("Process expired error:", error);
    next(error);
  }
};

// Send expiration reminders (admin/cron) - publishes to queue
export const sendReminders = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.isAdmin) {
      return next(new APIError("Forbidden: Admin access required", 403));
    }

    const { days = 7 } = req.query;

    const message = {
      eventType: "SUBSCRIPTION_EXPIRING_SOON",
      priority: PRIORITY.LOW,
      payload: {
        daysBeforeExpiry: parseInt(days as string, 10),
        triggeredBy: req.user.id,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({
      status: "success",
      message: "Expiration reminders have been queued for processing",
    });
  } catch (error: any) {
    logger.error("Send reminders error:", error);
    next(error);
  }
};

// Batch subscribe users (admin only - for imports) - publishes to queue
export const batchSubscribe = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user?.isAdmin) {
      return next(new APIError("Forbidden: Admin access required", 403));
    }

    const { subscriptions } = req.body;

    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
      return next(new APIError("subscriptions array is required", 400));
    }

    if (subscriptions.length > 1000) {
      return next(new APIError("Maximum 1000 subscriptions per batch", 400));
    }

    // Validate each subscription
    for (const sub of subscriptions) {
      if (!sub.userId || !sub.channelId) {
        return next(
          new APIError("Each subscription requires userId and channelId", 400),
        );
      }
    }

    const message = {
      eventType: "SUBSCRIPTION_BATCH_CREATE",
      priority: PRIORITY.MEDIUM,
      payload: {
        subscriptions,
        triggeredBy: req.user.id,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({
      status: "success",
      message: `Batch subscription request for ${subscriptions.length} items has been queued`,
    });
  } catch (error: any) {
    logger.error("Batch subscribe error:", error);
    next(error);
  }
};
