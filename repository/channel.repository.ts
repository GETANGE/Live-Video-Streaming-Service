import { prisma } from "@configs/database.config";
import redisClient from "@configs/redis.config";
import { PaginationParams, PaginatedResult } from "@types";
import { getChannelCacheKeys, invalidateChannelCache } from "@helpers/cacheInvalidations/channelCacheInvalidation";

const CACHE_TTL = 300; // 5 minutes

// Create channel
export const createChannel = async (data: {
  name: string;
  description?: string;
  ownerId: string;
  isPaid?: boolean;
  subscriptionPrice?: number;
  currency?: string;
}) => {
  const channel = await prisma.channel.create({
    data: {
      name: data.name,
      description: data.description,
      ownerId: data.ownerId,
      isPaid: data.isPaid || false,
      subscriptionPrice: data.subscriptionPrice,
      currency: data.currency || "KES",
    },
  });

  await invalidateChannelCache();
  return channel;
};

// Get channel by ID
export const getChannelById = async (id: string) => {
  const cacheKeys = await getChannelCacheKeys();
  const cacheKey = cacheKeys.byId(id);

  // Check cache
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      owner: {
        select: { id: true, username: true, imageUrl: true },
      },
      _count: {
        select: {
          subscriptions: { where: { status: "ACTIVE" } },
          videos: true,
        },
      },
    },
  });

  if (channel) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(channel));
  }

  return channel;
};

// Get channel by name
export const getChannelByName = async (name: string) => {
  const cacheKeys = await getChannelCacheKeys();
  const cacheKey = cacheKeys.byName(name);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const channel = await prisma.channel.findUnique({
    where: { name },
    include: {
      _count: {
        select: {
          subscriptions: { where: { status: "ACTIVE" } },
          videos: true,
        },
      },
    },
  });

  if (channel) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(channel));
  }

  return channel;
};

// Get channel by owner
export const getChannelByOwner = async (ownerId: string) => {
  const cacheKeys = await getChannelCacheKeys();
  const cacheKey = cacheKeys.byOwner(ownerId);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const channel = await prisma.channel.findFirst({
    where: { ownerId },
    include: {
      _count: {
        select: {
          subscriptions: { where: { status: "ACTIVE" } },
          videos: true,
        },
      },
    },
  });

  if (channel) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(channel));
  }

  return channel;
};

// Get all channels with pagination
export const getChannels = async (
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.channel.findMany({
      include: {
        _count: {
          select: {
            subscriptions: { where: { status: "ACTIVE" } },
            videos: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.channel.count(),
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

// Search channels by name
export const searchChannels = async (
  query: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const whereClause = {
    name: { contains: query, mode: "insensitive" as const },
  };

  const [data, total] = await Promise.all([
    prisma.channel.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            subscriptions: { where: { status: "ACTIVE" } },
            videos: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.channel.count({ where: whereClause }),
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

// Update channel
export const updateChannel = async (
  id: string,
  data: {
    name?: string;
    description?: string;
    isPaid?: boolean;
    subscriptionPrice?: number;
    currency?: string;
  }
) => {
  const channel = await prisma.channel.update({
    where: { id },
    data,
  });

  await invalidateChannelCache();
  return channel;
};

// Delete channel
export const deleteChannel = async (id: string) => {
  const channel = await prisma.channel.delete({
    where: { id },
  });

  await invalidateChannelCache();
  return channel;
};

// Get channel videos with pagination
export const getChannelVideos = async (
  channelId: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.video.findMany({
      where: { channelId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.video.count({ where: { channelId } }),
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

// Get channel stats
export const getChannelStats = async (channelId: string) => {
  const cacheKeys = await getChannelCacheKeys();
  const cacheKey = cacheKeys.stats(channelId);

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const [subscriberCount, videoCount, totalDuration] = await Promise.all([
    prisma.subscription.count({
      where: { channelId, status: "ACTIVE" },
    }),
    prisma.video.count({
      where: { channelId },
    }),
    prisma.video.aggregate({
      where: { channelId },
      _sum: { duration: true },
    }),
  ]);

  const stats = {
    subscriberCount,
    videoCount,
    totalDuration: totalDuration._sum?.duration || 0,
  };

  await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(stats));
  return stats;
};

// Get trending channels (by recent subscriber growth)
export const getTrendingChannels = async (limit: number = 10) => {
  const cacheKeys = await getChannelCacheKeys();
  const cacheKey = cacheKeys.trending();

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const channelGrowth = await prisma.subscription.groupBy({
    by: ["channelId"],
    where: {
      status: "ACTIVE",
      createdAt: { gte: sevenDaysAgo },
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });

  const channelIds = channelGrowth.map((c) => c.channelId);
  const channels = await prisma.channel.findMany({
    where: { id: { in: channelIds } },
    include: {
      _count: {
        select: {
          subscriptions: { where: { status: "ACTIVE" } },
          videos: true,
        },
      },
    },
  });

  const channelMap = new Map(channels.map((c) => [c.id, c]));

  const trending = channelGrowth.map((c) => ({
    ...channelMap.get(c.channelId),
    recentSubscribers: c._count.id,
  }));

  // Cache trending for 10 minutes
  await redisClient.setex(cacheKey, 600, JSON.stringify(trending));
  return trending;
};

// Check if user owns channel
export const isChannelOwner = async (
  channelId: string,
  userId: string
): Promise<boolean> => {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { ownerId: true },
  });
  return channel?.ownerId === userId;
};
