import { prisma } from "@configs/database.config";
import redisClient from "@configs/redis.config";
import { StreamKeyStatus } from "@generated/prisma/client";
import {
  getStreamKeyCacheKeys,
  invalidateStreamKeyCache,
} from "@helpers/cacheInvalidations/streamkeyCacheInvalidation";
import { v4 as uuidv4 } from "uuid";

const CACHE_TTL = 300; // 5 minutes

// Generate a unique stream key
const generateKey = (): string => {
  return `sk_live_${uuidv4().replace(/-/g, "")}`;
};

// Create stream key
export const createStreamKey = async (data: {
  userId: string;
  channelId: string;
  label?: string;
  expiresAt?: Date;
}) => {
  const key = generateKey();

  const streamKey = await prisma.streamKey.create({
    data: {
      key,
      userId: data.userId,
      channelId: data.channelId,
      label: data.label,
      expiresAt: data.expiresAt,
      status: "ACTIVE",
    },
    include: {
      channel: {
        select: { id: true, name: true },
      },
    },
  });

  await invalidateStreamKeyCache();
  return streamKey;
};

// Get stream key by ID
export const getStreamKeyById = async (id: string) => {
  const cacheKeys = await getStreamKeyCacheKeys();
  const cacheKey = cacheKeys.byId(id);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const streamKey = await prisma.streamKey.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, username: true },
      },
      channel: {
        select: { id: true, name: true },
      },
    },
  });

  if (streamKey) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(streamKey));
  }

  return streamKey;
};

// Get stream key by key value (for validation)
export const getStreamKeyByKey = async (key: string) => {
  const cacheKeys = await getStreamKeyCacheKeys();
  const cacheKey = cacheKeys.byKey(key);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const streamKey = await prisma.streamKey.findUnique({
    where: { key },
    include: {
      user: {
        select: { id: true, username: true },
      },
      channel: {
        select: { id: true, name: true, ownerId: true },
      },
    },
  });

  if (streamKey) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(streamKey));
  }

  return streamKey;
};

// Get all stream keys for a user
export const getStreamKeysByUser = async (userId: string) => {
  const cacheKeys = await getStreamKeyCacheKeys();
  const cacheKey = cacheKeys.byUser(userId);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const streamKeys = await prisma.streamKey.findMany({
    where: { userId },
    include: {
      channel: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (streamKeys.length > 0) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(streamKeys));
  }

  return streamKeys;
};

// Get all stream keys for a channel
export const getStreamKeysByChannel = async (channelId: string) => {
  const cacheKeys = await getStreamKeyCacheKeys();
  const cacheKey = cacheKeys.byChannel(channelId);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const streamKeys = await prisma.streamKey.findMany({
    where: { channelId },
    include: {
      user: {
        select: { id: true, username: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (streamKeys.length > 0) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(streamKeys));
  }

  return streamKeys;
};

// Update stream key status
export const updateStreamKeyStatus = async (
  id: string,
  status: StreamKeyStatus
) => {
  const streamKey = await prisma.streamKey.update({
    where: { id },
    data: { status },
    include: {
      channel: {
        select: { id: true, name: true },
      },
    },
  });

  await invalidateStreamKeyCache();
  return streamKey;
};

// Update last used timestamp
export const updateStreamKeyLastUsed = async (id: string) => {
  const streamKey = await prisma.streamKey.update({
    where: { id },
    data: { lastUsedAt: new Date() },
  });

  await invalidateStreamKeyCache();
  return streamKey;
};

// Revoke stream key (soft delete)
export const revokeStreamKey = async (id: string) => {
  const streamKey = await prisma.streamKey.update({
    where: { id },
    data: { status: "REVOKED" },
    include: {
      channel: {
        select: { id: true, name: true },
      },
    },
  });

  await invalidateStreamKeyCache();
  return streamKey;
};

// Rotate stream key (revoke old, create new)
export const rotateStreamKey = async (id: string) => {
  const oldKey = await prisma.streamKey.findUnique({
    where: { id },
  });

  if (!oldKey) {
    throw new Error("Stream key not found");
  }

  // Revoke old key and create new one in transaction
  const [, newStreamKey] = await prisma.$transaction([
    prisma.streamKey.update({
      where: { id },
      data: { status: "REVOKED" },
    }),
    prisma.streamKey.create({
      data: {
        key: generateKey(),
        userId: oldKey.userId,
        channelId: oldKey.channelId,
        label: oldKey.label,
        expiresAt: oldKey.expiresAt,
        status: "ACTIVE",
      },
      include: {
        channel: {
          select: { id: true, name: true },
        },
      },
    }),
  ]);

  await invalidateStreamKeyCache();
  return newStreamKey;
};

// Delete stream key (hard delete)
export const deleteStreamKey = async (id: string) => {
  const streamKey = await prisma.streamKey.delete({
    where: { id },
  });

  await invalidateStreamKeyCache();
  return streamKey;
};

// Check if stream key is valid
export const isStreamKeyValid = async (key: string): Promise<boolean> => {
  const streamKey = await getStreamKeyByKey(key);

  if (!streamKey) return false;
  if (streamKey.status !== "ACTIVE") return false;
  if (streamKey.expiresAt && new Date(streamKey.expiresAt) < new Date())
    return false;

  return true;
};

// Count active stream keys for user
export const countActiveStreamKeys = async (userId: string): Promise<number> => {
  return prisma.streamKey.count({
    where: {
      userId,
      status: "ACTIVE",
    },
  });
};
