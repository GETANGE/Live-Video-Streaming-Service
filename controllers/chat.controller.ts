import { Request, Response, NextFunction } from "express";
import * as chatService from "@services/chat.service";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

// Send a message
export const sendMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    const username = req.user?.username;
    if (!userId || !username) throw new APIError("Unauthorized", 401);

    const { streamId } = req.params;
    const { message } = req.body;
    const imageUrl = req.user?.imageUrl

    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (!message) throw new APIError("Message is required", 400);

    const chatMessage = await chatService.sendMessage(
      streamId,
      userId,
      username,
      message,
      imageUrl ?? undefined
    );

    res.status(201).json({
      success: true,
      data: chatMessage,
    });
  } catch (error) {
    logger.error("Send message error:", error);
    next(error);
  }
};

// Get chat history
export const getChatHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { streamId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await chatService.getChatHistory(streamId, { page, limit });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Get chat history error:", error);
    next(error);
  }
};

// Get pinned messages
export const getPinnedMessages = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { streamId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);

    const messages = await chatService.getPinnedMessages(streamId);

    res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    logger.error("Get pinned messages error:", error);
    next(error);
  }
};

// Delete a message
export const deleteMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId, messageId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (!messageId) throw new APIError("Message ID is required", 400);

    await chatService.deleteMessage(messageId, userId, streamId);

    res.status(200).json({
      success: true,
      message: "Message deleted",
    });
  } catch (error) {
    logger.error("Delete message error:", error);
    next(error);
  }
};

// Pin a message
export const pinMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId, messageId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (!messageId) throw new APIError("Message ID is required", 400);

    const message = await chatService.pinMessage(messageId, userId, streamId);

    res.status(200).json({
      success: true,
      data: message,
      message: "Message pinned",
    });
  } catch (error) {
    logger.error("Pin message error:", error);
    next(error);
  }
};

// Unpin a message
export const unpinMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId, messageId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (!messageId) throw new APIError("Message ID is required", 400);

    await chatService.unpinMessage(messageId, userId, streamId);

    res.status(200).json({
      success: true,
      message: "Message unpinned",
    });
  } catch (error) {
    logger.error("Unpin message error:", error);
    next(error);
  }
};

// Mute a user
export const muteUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId, targetUserId } = req.params;
    const { duration, reason } = req.body;

    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (!targetUserId) throw new APIError("Target user ID is required", 400);

    const log = await chatService.muteUser(
      streamId,
      targetUserId,
      userId,
      duration ? parseInt(duration) : undefined,
      reason
    );

    res.status(200).json({
      success: true,
      data: log,
      message: "User muted",
    });
  } catch (error) {
    logger.error("Mute user error:", error);
    next(error);
  }
};

// Ban a user
export const banUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId, targetUserId } = req.params;
    const { reason } = req.body;

    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (!targetUserId) throw new APIError("Target user ID is required", 400);

    const log = await chatService.banUser(streamId, targetUserId, userId, reason);

    res.status(200).json({
      success: true,
      data: log,
      message: "User banned",
    });
  } catch (error) {
    logger.error("Ban user error:", error);
    next(error);
  }
};

// Unban a user
export const unbanUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId, targetUserId } = req.params;

    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (!targetUserId) throw new APIError("Target user ID is required", 400);

    await chatService.unbanUser(streamId, targetUserId, userId);

    res.status(200).json({
      success: true,
      message: "User unbanned",
    });
  } catch (error) {
    logger.error("Unban user error:", error);
    next(error);
  }
};

// Get moderation logs
export const getModerationLogs = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);

    const logs = await chatService.getModerationLogs(streamId, userId);

    res.status(200).json({
      success: true,
      data: logs,
    });
  } catch (error) {
    logger.error("Get moderation logs error:", error);
    next(error);
  }
};

// Get banned users
export const getBannedUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);

    const users = await chatService.getBannedUsers(streamId, userId);

    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    logger.error("Get banned users error:", error);
    next(error);
  }
};

// Set slow mode
export const setSlowMode = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { streamId } = req.params;
    const { duration } = req.body;

    if (!streamId) throw new APIError("Stream ID is required", 400);
    if (duration === undefined) throw new APIError("Duration is required", 400);

    const result = await chatService.setSlowMode(
      streamId,
      userId,
      parseInt(duration)
    );

    res.status(200).json({
      success: true,
      data: result,
      message:
        result.slowMode > 0
          ? `Slow mode set to ${result.slowMode} seconds`
          : "Slow mode disabled",
    });
  } catch (error) {
    logger.error("Set slow mode error:", error);
    next(error);
  }
};

// Get slow mode status
export const getSlowModeStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { streamId } = req.params;
    if (!streamId) throw new APIError("Stream ID is required", 400);

    const slowMode = chatService.getSlowModeStatus(streamId);

    res.status(200).json({
      success: true,
      data: { slowMode },
    });
  } catch (error) {
    logger.error("Get slow mode status error:", error);
    next(error);
  }
};
