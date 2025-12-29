import { prisma } from "@configs/database.config";
import redisClient from "@configs/redis.config";
import { StreamStatus } from "@generated/prisma/client";
import { PaginationParams, PaginatedResult } from "@types";
import {
  getLivestreamCacheKeys,
  invalidateLivestreamCache,
  getViewerCount,
} from "@helpers/cacheInvalidations/livestreamCacheInvalidation";

const CACHE_TTL = 60; // 1 minute for live data (shorter TTL)

// Create livestream
export const createLiveStream = async (data: {
  title: string;
  description?: string;
  channelId: string;
  streamerId: string;
  streamKey: string;
  scheduledStart?: Date;
}) => {
  const liveStream = await prisma.liveStream.create({
    data: {
      title: data.title,
      description: data.description,
      channelId: data.channelId,
      streamerId: data.streamerId,
      streamKey: data.streamKey,
      scheduledStart: data.scheduledStart,
      status: "IDLE",
    },
    include: {
      channel: {
        select: { id: true, name: true },
      },
      streamer: {
        select: { id: true, username: true, imageUrl: true },
      },
    },
  });

  await invalidateLivestreamCache();
  return liveStream;
};

// Get livestream by ID
export const getLiveStreamById = async (id: string) => {
  const cacheKeys = await getLivestreamCacheKeys();
  const cacheKey = cacheKeys.byId(id);

  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    parsed.currentViewers = await getViewerCount(id);
    return parsed;
  }

  const liveStream = await prisma.liveStream.findUnique({
    where: { id },
    include: {
      channel: {
        select: { id: true, name: true, ownerId: true },
      },
      streamer: {
        select: { id: true, username: true, imageUrl: true },
      },
      _count: {
        select: { chatMessages: true },
      },
    },
  });

  if (liveStream) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(liveStream));
    (liveStream as any).currentViewers = await getViewerCount(id);
  }

  return liveStream;
};

// Get livestream by stream key
export const getLiveStreamByStreamKey = async (streamKey: string) => {
  const cacheKeys = await getLivestreamCacheKeys();
  const cacheKey = cacheKeys.byStreamKey(streamKey);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const liveStream = await prisma.liveStream.findUnique({
    where: { streamKey },
    include: {
      channel: {
        select: { id: true, name: true, ownerId: true },
      },
      streamer: {
        select: { id: true, username: true, imageUrl: true },
      },
    },
  });

  if (liveStream) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(liveStream));
  }

  return liveStream;
};

// Update livestream
export const updateLiveStream = async (
  id: string,
  data: {
    title?: string;
    description?: string;
    status?: StreamStatus;
    thumbnailUrl?: string;
    rtmpUrl?: string;
    hlsUrl?: string;
    startedAt?: Date;
    endedAt?: Date;
    duration?: number;
    peakViewers?: number;
    currentViewers?: number;
    totalViews?: number;
    vodVideoId?: string;
    vodStatus?: string;
  }
) => {
  const liveStream = await prisma.liveStream.update({
    where: { id },
    data,
    include: {
      channel: {
        select: { id: true, name: true },
      },
      streamer: {
        select: { id: true, username: true, imageUrl: true },
      },
    },
  });

  await invalidateLivestreamCache();
  return liveStream;
};

// Get all livestreams with pagination
export const getLiveStreams = async (
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.liveStream.findMany({
      include: {
        channel: {
          select: { id: true, name: true },
        },
        streamer: {
          select: { id: true, username: true, imageUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.liveStream.count(),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

// Get active (live) streams
export const getActiveLiveStreams = async (
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const whereClause = { status: "LIVE" as StreamStatus };

  const [data, total] = await Promise.all([
    prisma.liveStream.findMany({
      where: whereClause,
      include: {
        channel: {
          select: { id: true, name: true },
        },
        streamer: {
          select: { id: true, username: true, imageUrl: true },
        },
      },
      orderBy: { startedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.liveStream.count({ where: whereClause }),
  ]);

  // Add real-time viewer counts
  const dataWithViewers = await Promise.all(
    data.map(async (stream) => ({
      ...stream,
      currentViewers: await getViewerCount(stream.id),
    }))
  );

  const totalPages = Math.ceil(total / limit);

  return {
    data: dataWithViewers,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

// Get channel's livestreams
export const getChannelLiveStreams = async (
  channelId: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const whereClause = { channelId };

  const [data, total] = await Promise.all([
    prisma.liveStream.findMany({
      where: whereClause,
      include: {
        streamer: {
          select: { id: true, username: true, imageUrl: true },
        },
        _count: {
          select: { chatMessages: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.liveStream.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

// Get streamer's livestreams
export const getStreamerLiveStreams = async (
  streamerId: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const whereClause = { streamerId };

  const [data, total] = await Promise.all([
    prisma.liveStream.findMany({
      where: whereClause,
      include: {
        channel: {
          select: { id: true, name: true },
        },
        _count: {
          select: { chatMessages: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.liveStream.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

// Update peak viewers if current is higher
export const updatePeakViewers = async (
  id: string,
  currentViewers: number
): Promise<void> => {
  const stream = await prisma.liveStream.findUnique({
    where: { id },
    select: { peakViewers: true },
  });

  if (stream && currentViewers > stream.peakViewers) {
    await prisma.liveStream.update({
      where: { id },
      data: { peakViewers: currentViewers },
    });
  }
};

// Increment total views
export const incrementTotalViews = async (id: string): Promise<void> => {
  await prisma.liveStream.update({
    where: { id },
    data: { totalViews: { increment: 1 } },
  });
};

// Delete livestream
export const deleteLiveStream = async (id: string) => {
  const liveStream = await prisma.liveStream.delete({
    where: { id },
  });

  await invalidateLivestreamCache();
  return liveStream;
};

// Check if user is stream owner or channel owner
export const isStreamOwner = async (
  streamId: string,
  userId: string
): Promise<boolean> => {
  const stream = await prisma.liveStream.findUnique({
    where: { id: streamId },
    include: {
      channel: {
        select: { ownerId: true },
      },
    },
  });

  if (!stream) return false;
  return stream.streamerId === userId || stream.channel.ownerId === userId;
};

// Get stream statistics
export const getStreamStats = async (streamId: string) => {
  const stream = await prisma.liveStream.findUnique({
    where: { id: streamId },
    select: {
      peakViewers: true,
      totalViews: true,
      duration: true,
      startedAt: true,
      endedAt: true,
      _count: {
        select: { chatMessages: true },
      },
    },
  });

  if (!stream) return null;

  const currentViewers = await getViewerCount(streamId);

  return {
    ...stream,
    currentViewers,
    messageCount: stream._count.chatMessages,
  };
};
