import { prisma } from "@configs/database.config";
import { ModerationAction } from "@generated/prisma/client";
import redisClient from "@configs/redis.config";

const MODERATION_CACHE_PREFIX = "mod";
const CACHE_TTL = 300; // 5 minutes

// Create moderation log
export const createModerationLog = async (data: {
  streamId: string;
  moderatorId: string;
  targetUserId: string;
  action: ModerationAction;
  reason?: string;
  expiresAt?: Date;
}) => {
  return prisma.moderationLog.create({
    data: {
      streamId: data.streamId,
      moderatorId: data.moderatorId,
      targetUserId: data.targetUserId,
      action: data.action,
      reason: data.reason,
      expiresAt: data.expiresAt,
    },
    include: {
      moderator: {
        select: { id: true, username: true },
      },
      targetUser: {
        select: { id: true, username: true },
      },
    },
  });
};

// Get moderation status for a user in a stream
export const getUserModerationStatus = async (
  streamId: string,
  userId: string
): Promise<{
  isMuted: boolean;
  isBanned: boolean;
  muteExpiresAt?: Date;
  banReason?: string;
}> => {
  const cacheKey = `${MODERATION_CACHE_PREFIX}:status:${streamId}:${userId}`;

  // Check cache
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Get the most recent moderation actions for this user
  const [muteLog, banLog] = await Promise.all([
    prisma.moderationLog.findFirst({
      where: {
        streamId,
        targetUserId: userId,
        action: "MUTE",
        OR: [{ expiresAt: { gt: new Date() } }, { expiresAt: null }],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.moderationLog.findFirst({
      where: {
        streamId,
        targetUserId: userId,
        action: "BAN",
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Check if there's an unban after the ban
  let isBanned = false;
  let banReason: string | undefined;

  if (banLog) {
    const unbanLog = await prisma.moderationLog.findFirst({
      where: {
        streamId,
        targetUserId: userId,
        action: "UNBAN",
        createdAt: { gt: banLog.createdAt },
      },
    });
    isBanned = !unbanLog;
    banReason = isBanned ? banLog.reason || undefined : undefined;
  }

  const status = {
    isMuted: muteLog !== null && (!muteLog.expiresAt || muteLog.expiresAt > new Date()),
    isBanned,
    muteExpiresAt: muteLog?.expiresAt || undefined,
    banReason,
  };

  // Cache the result
  await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(status));

  return status;
};

// Check if user is muted
export const isUserMuted = async (
  streamId: string,
  userId: string
): Promise<boolean> => {
  const status = await getUserModerationStatus(streamId, userId);
  return status.isMuted;
};

// Check if user is banned
export const isUserBanned = async (
  streamId: string,
  userId: string
): Promise<boolean> => {
  const status = await getUserModerationStatus(streamId, userId);
  return status.isBanned;
};

// Invalidate moderation cache for a user
export const invalidateModerationCache = async (
  streamId: string,
  userId: string
): Promise<void> => {
  const cacheKey = `${MODERATION_CACHE_PREFIX}:status:${streamId}:${userId}`;
  await redisClient.del(cacheKey);
};

// Remove ban - cache invalidation is handled by the moderation action handler
export const removeBan = async (
  streamId: string,
  userId: string
): Promise<void> => {
  await invalidateModerationCache(streamId, userId);
};

// Get moderation logs for a stream
export const getStreamModerationLogs = async (
  streamId: string,
  limit: number = 100
) => {
  return prisma.moderationLog.findMany({
    where: { streamId },
    include: {
      moderator: {
        select: { id: true, username: true },
      },
      targetUser: {
        select: { id: true, username: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
};

// Get moderation logs for a specific user across all streams
export const getUserModerationHistory = async (
  userId: string,
  limit: number = 50
) => {
  return prisma.moderationLog.findMany({
    where: { targetUserId: userId },
    include: {
      moderator: {
        select: { id: true, username: true },
      },
      stream: {
        select: { id: true, title: true, channelId: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
};

// Get active mutes for a stream
export const getActiveMutes = async (streamId: string) => {
  return prisma.moderationLog.findMany({
    where: {
      streamId,
      action: "MUTE",
      OR: [{ expiresAt: { gt: new Date() } }, { expiresAt: null }],
    },
    include: {
      targetUser: {
        select: { id: true, username: true },
      },
      moderator: {
        select: { id: true, username: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

// Get banned users for a stream
export const getBannedUsers = async (streamId: string) => {
  // Get all bans
  const bans = await prisma.moderationLog.findMany({
    where: {
      streamId,
      action: "BAN",
    },
    include: {
      targetUser: {
        select: { id: true, username: true },
      },
      moderator: {
        select: { id: true, username: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Filter out users who have been unbanned
  const bannedUsers: typeof bans = [];

  for (const ban of bans) {
    const unban = await prisma.moderationLog.findFirst({
      where: {
        streamId,
        targetUserId: ban.targetUserId,
        action: "UNBAN",
        createdAt: { gt: ban.createdAt },
      },
    });

    if (!unban) {
      bannedUsers.push(ban);
    }
  }

  return bannedUsers;
};

// Count moderation actions by type for a stream
export const getModerationStats = async (streamId: string) => {
  const [mutes, bans, warns] = await Promise.all([
    prisma.moderationLog.count({
      where: { streamId, action: "MUTE" },
    }),
    prisma.moderationLog.count({
      where: { streamId, action: "BAN" },
    }),
    prisma.moderationLog.count({
      where: { streamId, action: "WARN" },
    }),
  ]);

  return { mutes, bans, warns, total: mutes + bans + warns };
};
