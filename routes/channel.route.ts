import express from "express";
import { protectRoute } from "@controllers/OAuthController";
import * as channelController from "@controllers/channel.controller";

const router = express.Router();

// ============ PUBLIC ROUTES ============

// Get all channels
router.get("/", channelController.getChannels);

// Search channels
router.get("/search", channelController.searchChannels);

// Get trending channels
router.get("/trending", channelController.getTrendingChannels);

// ============ AUTHENTICATED ROUTES ============

// Create channel
router.post("/", protectRoute, channelController.createChannel);

// Get my channel (must be before /:id)
router.get("/me", protectRoute, channelController.getMyChannel);

// Update channel
router.put("/:id", protectRoute, channelController.updateChannel);

// Delete channel
router.delete("/:id", protectRoute, channelController.deleteChannel);

// ============ PUBLIC ROUTES (with params) ============

// Get channel by ID
router.get("/:id", channelController.getChannel);

// Get channel videos
router.get("/:id/videos", channelController.getChannelVideos);

// Get channel stats
router.get("/:id/stats", channelController.getChannelStats);

export default router;
