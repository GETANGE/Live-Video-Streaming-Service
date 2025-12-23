import express from "express";
import { protectRoute } from "@controllers/OAuthController";
import * as notificationController from "@controllers/notificationsController";

const router = express.Router();

// Get all notifications for current user
router.get("/", protectRoute, notificationController.getNotifications);

// Get unread notifications
router.get("/unread", protectRoute, notificationController.getUnreadNotifications);

// Mark all as read
router.patch("/read-all", protectRoute, notificationController.markAllAsRead);

// Mark single notification as read
router.patch("/:id/read", protectRoute, notificationController.markAsRead);

// Delete notification
router.delete("/:id", protectRoute, notificationController.deleteNotification);

export default router;
