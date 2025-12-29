import { Request, Response, NextFunction } from "express";
import * as streamKeyService from "@services/streamkey.service";
import { publishMessage } from "@events/producers/streaming.publisher";
import { PRIORITY } from "@constants/constant";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

const notifyUser = (eventType: string, payload: object) => {
  publishMessage({
    eventType,
    priority: PRIORITY.LOW,
    payload,
  }).catch((err) => logger.warn(`Failed to queue notification: ${err.message}`));
};

// Generate a new stream key
export const generateStreamKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { channelId, label } = req.body;
    if (!channelId) throw new APIError("Channel ID is required", 400);

    const streamKey = await streamKeyService.generateStreamKey(
      userId,
      channelId,
      label
    );

    notifyUser("STREAM_KEY_GENERATED", {
      userId,
      channelId,
      streamKeyId: streamKey.id,
    });

    res.status(201).json({
      success: true,
      data: streamKey,
      message: "Stream key generated successfully",
    });
  } catch (error) {
    logger.error("Generate stream key error:", error);
    next(error);
  }
};

// Get my stream keys
export const getMyStreamKeys = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const streamKeys = await streamKeyService.getMyStreamKeys(userId);

    res.status(200).json({
      success: true,
      data: streamKeys,
    });
  } catch (error) {
    logger.error("Get my stream keys error:", error);
    next(error);
  }
};

// Get stream key by ID
export const getStreamKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Stream key ID is required", 400);

    const streamKey = await streamKeyService.getStreamKeyById(id, userId);

    res.status(200).json({
      success: true,
      data: streamKey,
    });
  } catch (error) {
    logger.error("Get stream key error:", error);
    next(error);
  }
};

// Revoke a stream key
export const revokeStreamKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Stream key ID is required", 400);

    const streamKey = await streamKeyService.revokeStreamKey(id, userId);

    notifyUser("STREAM_KEY_REVOKED", {
      userId,
      streamKeyId: id,
      channelId: streamKey.channelId,
    });

    res.status(200).json({
      success: true,
      data: streamKey,
      message: "Stream key revoked successfully",
    });
  } catch (error) {
    logger.error("Revoke stream key error:", error);
    next(error);
  }
};

// Rotate a stream key
export const rotateStreamKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Stream key ID is required", 400);

    const newStreamKey = await streamKeyService.rotateStreamKey(id, userId);

    notifyUser("STREAM_KEY_ROTATED", {
      userId,
      oldStreamKeyId: id,
      newStreamKeyId: newStreamKey.id,
      channelId: newStreamKey.channelId,
    });

    res.status(200).json({
      success: true,
      data: newStreamKey,
      message: "Stream key rotated successfully. Old key has been revoked.",
    });
  } catch (error) {
    logger.error("Rotate stream key error:", error);
    next(error);
  }
};

// Delete a stream key
export const deleteStreamKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { id } = req.params;
    if (!id) throw new APIError("Stream key ID is required", 400);

    await streamKeyService.deleteStreamKey(id, userId);

    notifyUser("STREAM_KEY_DELETED", {
      userId,
      streamKeyId: id,
    });

    res.status(200).json({
      success: true,
      message: "Stream key deleted successfully",
    });
  } catch (error) {
    logger.error("Delete stream key error:", error);
    next(error);
  }
};

// Get stream keys for a channel
export const getChannelStreamKeys = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { channelId } = req.params;
    if (!channelId) throw new APIError("Channel ID is required", 400);

    const streamKeys = await streamKeyService.getChannelStreamKeys(
      channelId,
      userId
    );

    res.status(200).json({
      success: true,
      data: streamKeys,
    });
  } catch (error) {
    logger.error("Get channel stream keys error:", error);
    next(error);
  }
};

// Validate stream key (internal API for RTMP server)
export const validateStreamKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { streamKey } = req.body;
    if (!streamKey) throw new APIError("Stream key is required", 400);

    const result = await streamKeyService.validateStreamKey(streamKey);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Validate stream key error:", error);
    next(error);
  }
};
