import * as chatRepo from "@repository/chat.repository";
import * as moderationRepo from "@repository/moderation.repository";
import { publishMessage } from "@events/producers/streaming.publisher";
import { PRIORITY } from "@constants/constant";
import {
  emitChatMessage,
  emitMessageDeleted,
  emitUserMuted,
  emitUserBanned,
  emitUserUnbanned,
} from "@configs/socket-live.config";
import {
  streamSlowMode,
  validateStreamIsLive,
  checkUserCanChat,
  checkRateLimits,
  processMessage,
  verifyModeratorPermission,
  validateModerationTarget,
} from "@helpers/chat.helper";
import {
  getChatHistoryCache,
  setChatHistoryCache,
  getPinnedMessagesCache,
  setPinnedMessagesCache,
  invalidateChatCache,
} from "@helpers/cacheInvalidations/chatCacheInvalidation";
import APIError from "@utils/APIError";
import logger from "@utils/logger";
import { PaginationParams } from "@types";

/**
 * Sends a chat message to a live stream.
 * Hybrid approach: validate + emit immediately, queue for async persistence.
 */
export const sendMessage = async (
  streamId: string,
  userId: string,
  username: string,
  message: string,
  imageUrl?: string
) => {
  // Step 1: Validate (sync - must pass before anything else)
  await validateStreamIsLive(streamId);
  await checkUserCanChat(streamId, userId);

  const slowModeDuration = streamSlowMode.get(streamId) || 0;
  await checkRateLimits(userId, streamId, slowModeDuration);

  const { filtered, wasFiltered, flagged } = await processMessage(
    message,
    streamId,
    userId
  );

  // Step 2: Persist to DB (sync - need messageId for real-time)
  const chatMessage = await chatRepo.createChatMessage({
    streamId,
    userId,
    message: filtered,
  });

  // Step 3: Emit immediately for real-time (sync)
  emitChatMessage(streamId, {
    id: chatMessage.id,
    userId,
    username,
    message: filtered,
    imageUrl,
    createdAt: chatMessage.createdAt.toISOString(),
    isHighlighted: chatMessage.isHighlighted,
    isPinned: chatMessage.isPinned,
  });

  // Step 4: Queue async tasks (flagging, cache invalidation)
  await publishMessage({
    eventType: "CHAT_MESSAGE",
    priority: PRIORITY.LOW,
    payload: {
      streamId,
      userId,
      username,
      message: filtered,
      imageUrl,
      flagged,
      messageId: chatMessage.id,
    },
  });

  return { ...chatMessage, wasFiltered };
};

// get chat history with version-based caching
export const getChatHistory = async (
  streamId: string,
  params: PaginationParams
) => {
  const page = params.page || 1;
  const limit = params.limit || 50;

  const cached = await getChatHistoryCache(streamId, page, limit);
  if (cached) return cached;

  const result = await chatRepo.getChatMessages(streamId, params);
  await setChatHistoryCache(streamId, page, limit, result);

  return result;
};

// get pinned messages with version-based caching
export const getPinnedMessages = async (streamId: string) => {
  const cached = await getPinnedMessagesCache(streamId);
  if (cached) return cached;

  const result = await chatRepo.getPinnedMessages(streamId);
  await setPinnedMessagesCache(streamId, result);

  return result;
};

/**
 * Deletes a message. Only stream/channel owner can delete.
 */
export const deleteMessage = async (
  messageId: string,
  moderatorId: string,
  streamId: string
) => {
  const message = await chatRepo.getChatMessageById(messageId);
  if (!message) throw new APIError("Message not found", 404);
  if (message.streamId !== streamId) {
    throw new APIError("Message does not belong to this stream", 400);
  }

  await verifyModeratorPermission(streamId, moderatorId, "delete messages");
  await chatRepo.deleteChatMessage(messageId);
  emitMessageDeleted(streamId, messageId);

  await invalidateChatCache();

  logger.info(`Message ${messageId} deleted by ${moderatorId}`);
  return { deleted: true };
};

// pin a Message in a stream.
export const pinMessage = async (
  messageId: string,
  moderatorId: string,
  streamId: string
) => {
  const message = await chatRepo.getChatMessageById(messageId);
  if (!message) throw new APIError("Message not found", 404);

  await verifyModeratorPermission(streamId, moderatorId, "pin messages");
  const result = await chatRepo.pinChatMessage(messageId, true);

  await invalidateChatCache();

  return result;
};

// unpin a Message in a stream.
export const unpinMessage = async (
  messageId: string,
  moderatorId: string,
  streamId: string
) => {
  await verifyModeratorPermission(streamId, moderatorId, "unpin messages");
  const result = await chatRepo.pinChatMessage(messageId, false);

  await invalidateChatCache();

  return result;
};

/**
 * Mutes a user for a specified duration (or indefinitely).
 * Emits immediately, queues for persistence.
 */
export const muteUser = async (
  streamId: string,
  targetUserId: string,
  moderatorId: string,
  durationSeconds?: number,
  reason?: string
) => {
  const stream = await verifyModeratorPermission(streamId, moderatorId, "mute users");
  validateModerationTarget(targetUserId, moderatorId, stream, "mute");

  const expiresAt = durationSeconds
    ? new Date(Date.now() + durationSeconds * 1000)
    : undefined;

  // Emit immediately for real-time
  emitUserMuted(streamId, {
    userId: targetUserId,
    moderatorId,
    reason,
    expiresAt: expiresAt?.toISOString(),
  });

  // Queue for async persistence
  await publishMessage({
    eventType: "MODERATION_ACTION",
    priority: PRIORITY.HIGH,
    payload: {
      streamId,
      moderatorId,
      targetUserId,
      action: "MUTE",
      reason,
      expiresAt: expiresAt?.toISOString(),
    },
  });

  logger.info(
    `User ${targetUserId} muted by ${moderatorId}` +
      (durationSeconds ? ` for ${durationSeconds}s` : " indefinitely")
  );

  return { success: true };
};

/**
 * Bans a user permanently from the stream chat.
 * Emits immediately, queues for persistence and message deletion.
 */
export const banUser = async (
  streamId: string,
  targetUserId: string,
  moderatorId: string,
  reason?: string
) => {
  const stream = await verifyModeratorPermission(streamId, moderatorId, "ban users");
  validateModerationTarget(targetUserId, moderatorId, stream, "ban");

  // Emit immediately for real-time
  emitUserBanned(streamId, { userId: targetUserId, moderatorId, reason });

  // Queue for async persistence and message deletion
  await publishMessage({
    eventType: "MODERATION_ACTION",
    priority: PRIORITY.HIGH,
    payload: {
      streamId,
      moderatorId,
      targetUserId,
      action: "BAN",
      reason,
      deleteMessages: true,
    },
  });

  logger.info(`User ${targetUserId} banned by ${moderatorId}`);

  return { success: true };
};

/**
 * Unbans a user from the stream chat.
 * Emits immediately, queues for persistence.
 */
export const unbanUser = async (
  streamId: string,
  targetUserId: string,
  moderatorId: string
) => {
  await verifyModeratorPermission(streamId, moderatorId, "unban users");

  const isBanned = await moderationRepo.isUserBanned(streamId, targetUserId);
  if (!isBanned) throw new APIError("User is not banned", 400);

  // Emit immediately for real-time
  emitUserUnbanned(streamId, targetUserId);

  // Queue for async persistence
  await publishMessage({
    eventType: "MODERATION_ACTION",
    priority: PRIORITY.HIGH,
    payload: {
      streamId,
      moderatorId,
      targetUserId,
      action: "UNBAN",
      reason: "Unbanned",
    },
  });

  logger.info(`User ${targetUserId} unbanned by ${moderatorId}`);

  return { success: true };
};

// get all moderation logs for a stream.
export const getModerationLogs = async (
  streamId: string,
  moderatorId: string
) => {
  await verifyModeratorPermission(streamId, moderatorId, "view moderation logs");
  return moderationRepo.getStreamModerationLogs(streamId);
};

export const getBannedUsers = async (streamId: string, moderatorId: string) => {
  await verifyModeratorPermission(streamId, moderatorId, "view banned users");
  return moderationRepo.getBannedUsers(streamId);
};

/**
 * Sets slow mode for the stream chat.
 * Duration 0 disables slow mode, max 300 seconds.
 */
export const setSlowMode = async (
  streamId: string,
  moderatorId: string,
  durationSeconds: number
) => {
  await verifyModeratorPermission(streamId, moderatorId, "set slow mode");

  if (durationSeconds < 0 || durationSeconds > 300) {
    throw new APIError("Slow mode must be between 0-300 seconds", 400);
  }

  if (durationSeconds === 0) {
    streamSlowMode.delete(streamId);
  } else {
    streamSlowMode.set(streamId, durationSeconds);
  }

  logger.info(
    `Slow mode ${durationSeconds > 0 ? `set to ${durationSeconds}s` : "disabled"}`
  );

  return { slowMode: durationSeconds };
};

export const getSlowModeStatus = (streamId: string): number => streamSlowMode.get(streamId) || 0;
