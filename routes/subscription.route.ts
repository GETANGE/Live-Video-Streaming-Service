import express from "express";
import {
  protectRoute,
  restrictToAdmin,
} from "@controllers/OAuthController";
import * as subscriptionController from "@controllers/subscriptionController";

const router = express.Router();

// ============ PUBLIC ROUTES ============

// Get subscriber count for a channel (public)
router.get(
  "/channels/:channelId/count",
  subscriptionController.getSubscriberCount
);

// Batch get subscriber counts (public - for channel listings)
router.post(
  "/channels/counts",
  subscriptionController.getMultipleSubscriberCounts
);

// Get channel subscribers (public with pagination)
router.get(
  "/channels/:channelId/subscribers",
  subscriptionController.getChannelSubscribers
);

// ============ AUTHENTICATED ROUTES ============

// Subscribe to a channel
router.post(
  "/channels/:channelId/subscribe",
  protectRoute,
  subscriptionController.subscribe
);

// Unsubscribe from a channel
router.delete(
  "/channels/:channelId/subscribe",
  protectRoute,
  subscriptionController.unsubscribe
);

// Check if subscribed to a channel
router.get(
  "/channels/:channelId/status",
  protectRoute,
  subscriptionController.checkSubscription
);

// Batch check subscription status (for UI)
router.post(
  "/check",
  protectRoute,
  subscriptionController.checkMultipleSubscriptions
);

// Get current user's subscriptions
router.get(
  "/me",
  protectRoute,
  subscriptionController.getMySubscriptions
);

// Get subscription by ID
router.get(
  "/:id",
  protectRoute,
  subscriptionController.getSubscriptionById
);

// ============ ADMIN ROUTES ============

// Get all subscriptions (admin)
router.get(
  "/",
  protectRoute,
  restrictToAdmin(),
  subscriptionController.getAllSubscriptions
);

// Get subscription stats (admin)
router.get(
  "/admin/stats",
  protectRoute,
  restrictToAdmin(),
  subscriptionController.getStats
);

// Get top channels by subscribers (admin)
router.get(
  "/admin/top-channels",
  protectRoute,
  restrictToAdmin(),
  subscriptionController.getTopChannels
);

// Process expired subscriptions (admin/cron)
router.post(
  "/admin/process-expired",
  protectRoute,
  restrictToAdmin(),
  subscriptionController.processExpired
);

// Send expiration reminders (admin/cron)
router.post(
  "/admin/send-reminders",
  protectRoute,
  restrictToAdmin(),
  subscriptionController.sendReminders
);

// Batch subscribe users (admin - for imports)
router.post(
  "/admin/batch",
  protectRoute,
  restrictToAdmin(),
  subscriptionController.batchSubscribe
);

export default router;
