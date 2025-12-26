import { Request, Response, NextFunction } from "express";
import * as channelService from "@services/channel.service";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

// Create channel
export const createChannel = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { name, description, isPaid, subscriptionPrice, currency } = req.body;
    if (!name) throw new APIError("Channel name is required", 400);

    const channel = await channelService.createChannel(userId, {
      name,
      description,
      isPaid,
      subscriptionPrice: subscriptionPrice ? Number(subscriptionPrice) : undefined,
      currency,
    });

    res.status(201).json({
      success: true,
      data: channel,
    });
  } catch (error) {
    logger.error("Create channel error:", error);
    next(error);
  }
};

// Get channel by ID
export const getChannel = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    if (!id) throw new APIError("Channel ID is required", 400);

    const channel = await channelService.getChannel(id);

    res.status(200).json({
      success: true,
      data: channel,
    });
  } catch (error) {
    logger.error("Get channel error:", error);
    next(error);
  }
};

// Get my channels
export const getMyChannels = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const channels = await channelService.getMyChannels(userId);

    res.status(200).json({
      success: true,
      data: channels,
    });
  } catch (error) {
    logger.error("Get my channels error:", error);
    next(error);
  }
};

// Get all channels
export const getChannels = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await channelService.getChannels({ page, limit });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Get channels error:", error);
    next(error);
  }
};

// Search channels
export const searchChannels = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const query = req.query.q as string;
    if (!query) throw new APIError("Search query is required", 400);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await channelService.searchChannels(query, { page, limit });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Search channels error:", error);
    next(error);
  }
};

// Update channel
export const updateChannel = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Channel ID is required", 400);

    const { name, description, isPaid, subscriptionPrice, currency } = req.body;

    const channel = await channelService.updateChannel(id, userId, {
      name,
      description,
      isPaid,
      subscriptionPrice: subscriptionPrice ? Number(subscriptionPrice) : undefined,
      currency,
    });

    res.status(200).json({
      success: true,
      data: channel,
    });
  } catch (error) {
    logger.error("Update channel error:", error);
    next(error);
  }
};

// Delete channel
export const deleteChannel = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Channel ID is required", 400);

    await channelService.deleteChannel(id, userId);

    res.status(202).json({
      success: true,
      message: "Channel deletion queued for processing",
    });
  } catch (error) {
    logger.error("Delete channel error:", error);
    next(error);
  }
};

// Get channel videos
export const getChannelVideos = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    if (!id) throw new APIError("Channel ID is required", 400);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await channelService.getChannelVideos(id, { page, limit });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Get channel videos error:", error);
    next(error);
  }
};

// Get channel stats
export const getChannelStats = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    if (!id) throw new APIError("Channel ID is required", 400);

    const stats = await channelService.getChannelStats(id);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Get channel stats error:", error);
    next(error);
  }
};

// Get trending channels
export const getTrendingChannels = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const channels = await channelService.getTrendingChannels(limit);

    res.status(200).json({
      success: true,
      data: channels,
    });
  } catch (error) {
    logger.error("Get trending channels error:", error);
    next(error);
  }
};
