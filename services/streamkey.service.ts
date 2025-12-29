import * as streamKeyRepo from "@repository/streamkey.repository";
import * as channelRepo from "@repository/channel.repository";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

const MAX_KEYS_PER_USER = 5; // Maximum stream keys per user

// Generate a new stream key
export const generateStreamKey = async (
  userId: string,
  channelId: string,
  label?: string
) => {
  // Verify channel exists and user owns it
  const channel = await channelRepo.getChannelById(channelId);
  if (!channel) {
    throw new APIError("Channel not found", 404);
  }

  if (channel.ownerId !== userId) {
    throw new APIError("You do not own this channel", 403);
  }

  // Check if user has reached max keys
  const activeKeyCount = await streamKeyRepo.countActiveStreamKeys(userId);
  if (activeKeyCount >= MAX_KEYS_PER_USER) {
    throw new APIError(
      `Maximum ${MAX_KEYS_PER_USER} active stream keys allowed`,
      400
    );
  }

  // Check for duplicate label
  if (label) {
    const existingKeys = await streamKeyRepo.getStreamKeysByChannel(channelId);
    const duplicateLabel = existingKeys.find(
      (k: { label?: string | null; status: string }) =>
        k.label === label && k.status === "ACTIVE"
    );
    if (duplicateLabel) {
      throw new APIError(`Stream key with label "${label}" already exists`, 400);
    }
  }

  const streamKey = await streamKeyRepo.createStreamKey({
    userId,
    channelId,
    label: label || "Primary",
  });

  logger.info(`Stream key generated for channel ${channelId} by user ${userId}`);

  return streamKey;
};

// Validate a stream key (for RTMP server)
export const validateStreamKey = async (key: string) => {
  const streamKey = await streamKeyRepo.getStreamKeyByKey(key);

  if (!streamKey) {
    logger.warn(`Invalid stream key attempted: ${key.substring(0, 10)}...`);
    return { valid: false, reason: "STREAM_KEY_INVALID" };
  }

  if (streamKey.status === "REVOKED") {
    logger.warn(`Revoked stream key attempted: ${streamKey.id}`);
    return { valid: false, reason: "STREAM_KEY_REVOKED" };
  }

  if (streamKey.status === "EXPIRED") {
    logger.warn(`Expired stream key attempted: ${streamKey.id}`);
    return { valid: false, reason: "STREAM_KEY_EXPIRED" };
  }

  if (streamKey.expiresAt && new Date(streamKey.expiresAt) < new Date()) {
    // Mark as expired
    await streamKeyRepo.updateStreamKeyStatus(streamKey.id, "EXPIRED");
    logger.warn(`Stream key expired: ${streamKey.id}`);
    return { valid: false, reason: "STREAM_KEY_EXPIRED" };
  }

  // Update last used timestamp
  await streamKeyRepo.updateStreamKeyLastUsed(streamKey.id);

  logger.info(`Stream key validated: ${streamKey.id}`);

  return {
    valid: true,
    streamKey: {
      id: streamKey.id,
      userId: streamKey.userId,
      channelId: streamKey.channelId,
      channelName: streamKey.channel.name,
    },
  };
};

// Get user's stream keys
export const getMyStreamKeys = async (userId: string) => {
  const streamKeys = await streamKeyRepo.getStreamKeysByUser(userId);

  // Mask the actual key for security (only show last 8 characters)
  return streamKeys.map((sk: { key: string; [key: string]: unknown }) => ({
    ...sk,
    key: `sk_live_${"*".repeat(24)}${sk.key.slice(-8)}`,
    fullKey: sk.key, // Include full key only if needed
  }));
};

// Get stream key by ID (for user who owns it)
export const getStreamKeyById = async (keyId: string, userId: string) => {
  const streamKey = await streamKeyRepo.getStreamKeyById(keyId);

  if (!streamKey) {
    throw new APIError("Stream key not found", 404);
  }

  if (streamKey.userId !== userId) {
    throw new APIError("You do not own this stream key", 403);
  }

  return streamKey;
};

// Revoke a stream key
export const revokeStreamKey = async (keyId: string, userId: string) => {
  const streamKey = await streamKeyRepo.getStreamKeyById(keyId);

  if (!streamKey) {
    throw new APIError("Stream key not found", 404);
  }

  if (streamKey.userId !== userId) {
    throw new APIError("You do not own this stream key", 403);
  }

  if (streamKey.status === "REVOKED") {
    throw new APIError("Stream key is already revoked", 400);
  }

  const revokedKey = await streamKeyRepo.revokeStreamKey(keyId);

  logger.info(`Stream key revoked: ${keyId} by user ${userId}`);

  return revokedKey;
};

// Rotate a stream key (revoke old, create new)
export const rotateStreamKey = async (keyId: string, userId: string) => {
  const streamKey = await streamKeyRepo.getStreamKeyById(keyId);

  if (!streamKey) {
    throw new APIError("Stream key not found", 404);
  }

  if (streamKey.userId !== userId) {
    throw new APIError("You do not own this stream key", 403);
  }

  if (streamKey.status !== "ACTIVE") {
    throw new APIError("Can only rotate active stream keys", 400);
  }

  const newKey = await streamKeyRepo.rotateStreamKey(keyId);

  logger.info(`Stream key rotated: ${keyId} -> ${newKey.id} by user ${userId}`);

  return newKey;
};

// Delete a stream key permanently
export const deleteStreamKey = async (keyId: string, userId: string) => {
  const streamKey = await streamKeyRepo.getStreamKeyById(keyId);

  if (!streamKey) {
    throw new APIError("Stream key not found", 404);
  }

  if (streamKey.userId !== userId) {
    throw new APIError("You do not own this stream key", 403);
  }

  await streamKeyRepo.deleteStreamKey(keyId);

  logger.info(`Stream key deleted: ${keyId} by user ${userId}`);

  return { deleted: true };
};

// Get stream keys for a channel (channel owner only)
export const getChannelStreamKeys = async (
  channelId: string,
  userId: string
) => {
  const channel = await channelRepo.getChannelById(channelId);

  if (!channel) {
    throw new APIError("Channel not found", 404);
  }

  if (channel.ownerId !== userId) {
    throw new APIError("You do not own this channel", 403);
  }

  return streamKeyRepo.getStreamKeysByChannel(channelId);
};
