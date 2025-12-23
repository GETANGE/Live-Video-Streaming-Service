import { Request, Response, NextFunction } from "express";
import * as repo from "@repository/notification.repository";
import { publishMessage } from "@events/producers/streaming.publisher";
import { PRIORITY } from "@constants/constant";
import APIError from "@utils/APIError";

// GET operations - synchronous (need immediate response)
export const getNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const notifications = await repo.getNotificationsByUserId(userId);
    res.json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

export const getUnreadNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const notifications = await repo.getUnreadNotifications(userId);
    res.json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

// WRITE operations - publish to queue
export const markAsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const id = req.params.id;
    if (!id) throw new APIError("Notification ID required", 400);

    const message = {
      eventType: "NOTIFICATION_MARK_READ",
      priority: PRIORITY.LOW,
      payload: {
        notificationId: id,
        userId,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({ success: true, message: "Notification will be marked as read" });
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const message = {
      eventType: "NOTIFICATION_MARK_ALL_READ",
      priority: PRIORITY.LOW,
      payload: {
        userId,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({ success: true, message: "All notifications will be marked as read" });
  } catch (error) {
    next(error);
  }
};

export const deleteNotification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const id = req.params.id;
    if (!id) throw new APIError("Notification ID required", 400);

    const message = {
      eventType: "NOTIFICATION_DELETE",
      priority: PRIORITY.MEDIUM,
      payload: {
        notificationId: id,
        userId,
        timestamp: new Date().toISOString(),
      },
    };

    await publishMessage(message);

    res.status(202).json({ success: true, message: "Notification will be deleted" });
  } catch (error) {
    next(error);
  }
};
