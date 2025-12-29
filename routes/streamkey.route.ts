import express from "express";
import { protectRoute } from "@controllers/OAuthController";
import * as streamKeyController from "@controllers/streamkey.controller";

const router = express.Router();

// ============ AUTHENTICATED ROUTES ============
// All stream key routes require authentication

// Generate a new stream key
router.post("/generate", protectRoute, streamKeyController.generateStreamKey);

// Get my stream keys
router.get("/", protectRoute, streamKeyController.getMyStreamKeys);

// Get stream key by ID
router.get("/:id", protectRoute, streamKeyController.getStreamKey);

// Revoke a stream key
router.delete("/:id", protectRoute, streamKeyController.revokeStreamKey);

// Rotate a stream key (revoke old, create new)
router.post("/:id/rotate", protectRoute, streamKeyController.rotateStreamKey);

// Delete a stream key permanently
router.delete("/:id/permanent", protectRoute, streamKeyController.deleteStreamKey);

// Get stream keys for a specific channel
router.get(
  "/channel/:channelId",
  protectRoute,
  streamKeyController.getChannelStreamKeys
);

export default router;
