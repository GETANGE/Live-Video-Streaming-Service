import express from "express";
import { protectRoute } from "@controllers/OAuthController";
import * as chatController from "@controllers/chat.controller";

const router = express.Router();

// ============ PUBLIC ROUTES ============

// Get chat history
router.get("/:streamId/history", chatController.getChatHistory);

// Get pinned messages
router.get("/:streamId/pinned", chatController.getPinnedMessages);

// Get slow mode status
router.get("/:streamId/slow-mode", chatController.getSlowModeStatus);

// ============ AUTHENTICATED ROUTES ============

// Send a message
router.post("/:streamId/messages", protectRoute, chatController.sendMessage);

// Delete a message
router.delete(
  "/:streamId/messages/:messageId",
  protectRoute,
  chatController.deleteMessage
);

// Pin a message
router.post(
  "/:streamId/messages/:messageId/pin",
  protectRoute,
  chatController.pinMessage
);

// Unpin a message
router.delete(
  "/:streamId/messages/:messageId/pin",
  protectRoute,
  chatController.unpinMessage
);

// ============ MODERATION ROUTES ============

// Mute a user
router.post("/:streamId/mute/:targetUserId", protectRoute, chatController.muteUser);

// Ban a user
router.post("/:streamId/ban/:targetUserId", protectRoute, chatController.banUser);

// Unban a user
router.post(
  "/:streamId/unban/:targetUserId",
  protectRoute,
  chatController.unbanUser
);

// Get moderation logs
router.get("/:streamId/moderation", protectRoute, chatController.getModerationLogs);

// Get banned users
router.get("/:streamId/banned", protectRoute, chatController.getBannedUsers);

// Set slow mode
router.post("/:streamId/slow-mode", protectRoute, chatController.setSlowMode);

export default router;
