import { Request, Response, NextFunction } from "express";
import * as livestreamService from "@services/livestream.service";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

// Create a new livestream
export const createStream = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { channelId, title, description, scheduledStart } = req.body;

    if (!channelId) throw new APIError("Channel ID is required", 400);
    if (!title) throw new APIError("Title is required", 400);

    const stream = await livestreamService.createStream(userId, channelId, {
      title,
      description,
      scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
    });

    res.status(201).json({
      success: true,
      data: stream,
      message: "Livestream created successfully",
    });
  } catch (error) {
    logger.error("Create stream error:", error);
    next(error);
  }
};

// Get stream by ID
export const getStream = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    if (!id) throw new APIError("Stream ID is required", 400);

    const stream = await livestreamService.getStream(id);

    res.status(200).json({
      success: true,
      data: stream,
    });
  } catch (error) {
    logger.error("Get stream error:", error);
    next(error);
  }
};

// Get all livestreams
export const getLiveStreams = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await livestreamService.getLiveStreams({ page, limit });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Get livestreams error:", error);
    next(error);
  }
};

// Get active (live) streams
export const getActiveLiveStreams = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await livestreamService.getActiveLiveStreams({ page, limit });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Get active streams error:", error);
    next(error);
  }
};

// Get channel's streams
export const getChannelStreams = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { channelId } = req.params;
    if (!channelId) throw new APIError("Channel ID is required", 400);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await livestreamService.getChannelStreams(channelId, {
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Get channel streams error:", error);
    next(error);
  }
};

// Get my streams
export const getMyStreams = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await livestreamService.getMyStreams(userId, { page, limit });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Get my streams error:", error);
    next(error);
  }
};

// End a stream
export const endStream = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Stream ID is required", 400);

    const stream = await livestreamService.endStream(id, userId);

    res.status(200).json({
      success: true,
      data: stream,
      message: "Stream ended successfully",
    });
  } catch (error) {
    logger.error("End stream error:", error);
    next(error);
  }
};

// Update stream
export const updateStream = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Stream ID is required", 400);

    const { title, description, thumbnailUrl } = req.body;

    const stream = await livestreamService.updateStream(id, userId, {
      title,
      description,
      thumbnailUrl,
    });

    res.status(200).json({
      success: true,
      data: stream,
      message: "Stream updated successfully",
    });
  } catch (error) {
    logger.error("Update stream error:", error);
    next(error);
  }
};

// Get stream statistics
export const getStreamStats = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    if (!id) throw new APIError("Stream ID is required", 400);

    const stats = await livestreamService.getStreamStats(id);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Get stream stats error:", error);
    next(error);
  }
};

// Delete a stream
export const deleteStream = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Stream ID is required", 400);

    await livestreamService.deleteStream(id, userId);

    res.status(200).json({
      success: true,
      message: "Stream deleted successfully",
    });
  } catch (error) {
    logger.error("Delete stream error:", error);
    next(error);
  }
};

// Get viewer count
export const getViewerCount = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    if (!id) throw new APIError("Stream ID is required", 400);

    const count = await livestreamService.getStreamViewerCount(id);

    res.status(200).json({
      success: true,
      data: { viewerCount: count },
    });
  } catch (error) {
    logger.error("Get viewer count error:", error);
    next(error);
  }
};

// Start stream (internal API for RTMP server)
export const startStreamInternal = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { streamKey, channelId, userId } = req.body;

    if (!streamKey) throw new APIError("Stream key is required", 400);

    const stream = await livestreamService.startStream(streamKey);

    res.status(200).json({
      success: true,
      data: stream,
      message: "Stream started",
    });
  } catch (error) {
    logger.error("Start stream internal error:", error);
    next(error);
  }
};

// End stream (internal API for RTMP server)
export const endStreamInternal = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { streamKey } = req.body;

    if (!streamKey) throw new APIError("Stream key is required", 400);

    const stream = await livestreamService.endStreamByKey(streamKey);

    res.status(200).json({
      success: true,
      data: stream,
      message: "Stream ended",
    });
  } catch (error) {
    logger.error("End stream internal error:", error);
    next(error);
  }
};
