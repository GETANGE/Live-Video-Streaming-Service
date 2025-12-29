import * as moderationRepo from "@repository/moderation.repository";
import * as livestreamRepo from "@repository/livestream.repository";
import * as chatRepo from "@repository/chat.repository";
import {
  checkChatRateLimit,
  checkSlowModeRateLimit,
} from "@middleware/chatRateLimit.middleware";
import { filterMessage, sanitizeMessage, isSpam } from "@utils/wordFilter";
import APIError from "@utils/APIError";

// Stream slow mode settings (in seconds, 0 = disabled)
export const streamSlowMode = new Map<string, number>();


// ensure stream exists and is live.
export const validateStreamIsLive = async (streamId: string) => {
  const stream = await livestreamRepo.getLiveStreamById(streamId);
  if (!stream) {
    throw new APIError("Stream not found", 404);
  }
  if (stream.status !== "LIVE") {
    throw new APIError("Chat is only available during live streams", 400);
  }
  return stream;
};

// ensure user is not banned or muted.
export const checkUserCanChat = async (streamId: string, userId: string) => {
  const isBanned = await moderationRepo.isUserBanned(streamId, userId);
  if (isBanned) {
    throw new APIError("You are banned from this chat", 403);
  }

  const isMuted = await moderationRepo.isUserMuted(streamId, userId);
  if (isMuted) {
    throw new APIError("You are currently muted", 403);
  }
};

// enforce rate limiting + slow mode.
export const checkRateLimits = async (
  userId: string,
  streamId: string,
  slowModeDuration: number
) => {
  await checkChatRateLimit(userId, streamId);
  await checkSlowModeRateLimit(userId, streamId, slowModeDuration);
};

// sanitize , filter profanity and detect spam.
export const processMessage = async (
  message: string,
  streamId: string,
  userId: string
) => {
  const sanitizedMessage = sanitizeMessage(message);

  if (!sanitizedMessage || sanitizedMessage.length === 0) {
    throw new APIError("Message cannot be empty", 400);
  }

  const spam = await isSpam(sanitizedMessage, userId, streamId);
  if (spam) {
    throw new APIError("Message detected as spam", 400);
  }

  const { filtered, wasFiltered, flagged } = await filterMessage(sanitizedMessage);

  return { filtered, wasFiltered, flagged };
};

// check if user is a stream/channel owner.
export const verifyModeratorPermission = async (
  streamId: string,
  moderatorId: string,
  action: string
) => {
  const stream = await livestreamRepo.getLiveStreamById(streamId);
  if (!stream) {
    throw new APIError("Stream not found", 404);
  }

  const isOwner =
    stream.streamerId === moderatorId || stream.channel.ownerId === moderatorId;

  if (!isOwner) {
    throw new APIError(`You do not have permission to ${action}`, 403);
  }

  return stream;
};

// prevent self moderation and owner moderation.
export const validateModerationTarget = (
  targetUserId: string,
  moderatorId: string,
  stream: { streamerId: string; channel: { ownerId: string } },
  action: string
) => {
  if (targetUserId === moderatorId) {
    throw new APIError(`You cannot ${action} yourself`, 400);
  }

  if (
    targetUserId === stream.streamerId ||
    targetUserId === stream.channel.ownerId
  ) {
    throw new APIError(`Cannot ${action} the stream or channel owner`, 400);
  }
};
