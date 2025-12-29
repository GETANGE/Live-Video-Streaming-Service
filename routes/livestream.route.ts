import express from "express";
import { protectRoute } from "@controllers/OAuthController";
import * as livestreamController from "@controllers/livestream.controller";

const router = express.Router();

// ============ PUBLIC ROUTES ============

// Get all livestreams
router.get("/", livestreamController.getLiveStreams);

// Get active (live) streams
router.get("/live", livestreamController.getActiveLiveStreams);

// Get channel's streams
router.get("/channel/:channelId", livestreamController.getChannelStreams);

// ============ AUTHENTICATED ROUTES ============

// Create a new livestream
router.post("/", protectRoute, livestreamController.createStream);

// Get my streams
router.get("/me", protectRoute, livestreamController.getMyStreams);

// Update stream
router.put("/:id", protectRoute, livestreamController.updateStream);

// End a stream
router.post("/:id/end", protectRoute, livestreamController.endStream);

// Delete a stream
router.delete("/:id", protectRoute, livestreamController.deleteStream);

// ============ PUBLIC ROUTES (with params) ============

// Get stream by ID
router.get("/:id", livestreamController.getStream);

// Get stream statistics
router.get("/:id/stats", livestreamController.getStreamStats);

// Get viewer count
router.get("/:id/viewers", livestreamController.getViewerCount);

export default router;
