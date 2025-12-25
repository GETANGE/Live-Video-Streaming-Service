import { prisma, Prisma } from "@configs/database.config";
import { SubscriptionStatus } from "@generated/prisma/client";
import { PaginationParams, PaginatedResult } from "@types";


// Find a specific subscription
export const findSubscription = async (userId: string, channelId: string) => {
  return prisma.subscription.findFirst({
    where: { userId, channelId },
    include: { channel: true },
  });
};

// Find active subscription only
export const findActiveSubscription = async (
  userId: string,
  channelId: string
) => {
  return prisma.subscription.findFirst({
    where: {
      userId,
      channelId,
      status: "ACTIVE",
    },
    include: { channel: true },
  });
};

// Create subscription
export const createSubscription = async (
  userId: string,
  channelId: string,
  endDate?: Date
) => {
  return prisma.subscription.create({
    data: {
      userId,
      channelId,
      status: "ACTIVE",
      startDate: new Date(),
      endDate,
    },
    include: { channel: true, user: true },
  });
};

// Create subscription with payment (for paid channels)
export const createSubscriptionWithPayment = async (
  userId: string,
  channelId: string,
  paymentId: string,
  amountPaid: number,
  endDate?: Date
) => {
  return prisma.subscription.create({
    data: {
      userId,
      channelId,
      status: "ACTIVE",
      startDate: new Date(),
      endDate,
      paymentId,
      amountPaid,
    },
    include: { channel: true, user: true, payment: true },
  });
};

// Cancel subscription (soft delete)
export const cancelSubscription = async (id: string) => {
  return prisma.subscription.update({
    where: { id },
    data: {
      status: "CANCELLED",
      endDate: new Date(),
    },
    include: { channel: true },
  });
};

// Reactivate subscription
export const reactivateSubscription = async (id: string, endDate?: Date) => {
  return prisma.subscription.update({
    where: { id },
    data: {
      status: "ACTIVE",
      startDate: new Date(),
      endDate,
    },
    include: { channel: true },
  });
};

// Expire subscription
export const expireSubscription = async (id: string) => {
  return prisma.subscription.update({
    where: { id },
    data: { status: "EXPIRED" },
  });
};

// Get subscription by ID
export const getSubscriptionById = async (id: string) => {
  return prisma.subscription.findUnique({
    where: { id },
    include: { channel: true, user: true },
  });
};

// Get subscriptions by user with pagination
export const getSubscriptionsByUserId = async (
  userId: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId },
      include: { channel: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.subscription.count({ where: { userId } }),
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
      hasPrev: page > 1
    },
  };
};

// Get active subscriptions by user
export const getActiveSubscriptionsByUserId = async (
  userId: string,
  params: PaginationParams = {}
) => {
  const { page = 1, limit = 20 } = params;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.subscription.findMany({
      where: { userId, status: "ACTIVE" },
      include: { channel: true },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.subscription.count({ where: { userId, status: "ACTIVE" } }),
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

// Get subscribers of a channel with cursor-based pagination (for scale)
export const getChannelSubscribers = async (
  channelId: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { limit = 50, cursor } = params;

  const whereClause: Prisma.SubscriptionWhereInput = {
    channelId,
    status: "ACTIVE",
  };

  // Cursor-based pagination for large subscriber lists
  const cursorClause = cursor ? { id: cursor } : undefined;

  const [data, total] = await Promise.all([
    prisma.subscription.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, username: true, imageUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1, // Fetch one extra to check if there's more
      ...(cursorClause && { cursor: cursorClause, skip: 1 }),
    }),
    prisma.subscription.count({ where: whereClause }),
  ]);

  const hasNext = data.length > limit;
  if (hasNext) data.pop(); // Remove the extra item

  return {
    data,
    pagination: {
      total,
      page: 1,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext,
      hasPrev: !!cursor
    },
  };
};

// Get subscriber count for a channel (optimized)
export const getChannelSubscriberCount = async (channelId: string) => {
  return prisma.subscription.count({
    where: { channelId, status: "ACTIVE" },
  });
};

// Batch get subscriber counts for multiple channels
export const getMultipleChannelSubscriberCounts = async (
  channelIds: string[]
): Promise<Map<string, number>> => {
  const counts = await prisma.subscription.groupBy({
    by: ["channelId"],
    where: {
      channelId: { in: channelIds },
      status: "ACTIVE",
    },
    _count: { id: true },
  });

  const countMap = new Map<string, number>();
  channelIds.forEach((id) => countMap.set(id, 0));
  counts.forEach((c) => countMap.set(c.channelId, c._count.id));

  return countMap;
};

// Check if user is subscribed to channel
export const isUserSubscribed = async (
  userId: string,
  channelId: string
): Promise<boolean> => {
  const count = await prisma.subscription.count({
    where: { userId, channelId, status: "ACTIVE" },
  });
  return count > 0;
};

// Batch check subscriptions for multiple channels
export const getUserSubscriptionStatus = async (
  userId: string,
  channelIds: string[]
): Promise<Map<string, boolean>> => {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      userId,
      channelId: { in: channelIds },
      status: "ACTIVE",
    },
    select: { channelId: true },
  });

  const statusMap = new Map<string, boolean>();
  channelIds.forEach((id) => statusMap.set(id, false));
  subscriptions.forEach((s) => statusMap.set(s.channelId, true));

  return statusMap;
};

// Get all subscriptions (admin) with pagination
export const getAllSubscriptions = async (
  params: PaginationParams = {},
  status?: SubscriptionStatus
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 50 } = params;
  const skip = (page - 1) * limit;

  const whereClause: Prisma.SubscriptionWhereInput = status ? { status } : {};

  const [data, total] = await Promise.all([
    prisma.subscription.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, username: true, email: true } },
        channel: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.subscription.count({ where: whereClause }),
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

// Batch subscribe users to channel (for imports/migrations)
export const batchSubscribe = async (
  subscriptions: Array<{ userId: string; channelId: string; endDate?: Date }>
) => {
  return prisma.subscription.createMany({
    data: subscriptions.map((s) => ({
      userId: s.userId,
      channelId: s.channelId,
      status: "ACTIVE" as const,
      startDate: new Date(),
      endDate: s.endDate,
    })),
    skipDuplicates: true,
  });
};

// Batch expire subscriptions (for cron jobs)
export const batchExpireSubscriptions = async () => {
  const now = new Date();

  return prisma.subscription.updateMany({
    where: {
      status: "ACTIVE",
      endDate: { lte: now },
    },
    data: { status: "EXPIRED" },
  });
};

// Get expiring subscriptions (for renewal reminders)
export const getExpiringSubscriptions = async (
  withinDays: number = 7
): Promise<any[]> => {
  const now = new Date();
  const futureDate = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  return prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      endDate: {
        gte: now,
        lte: futureDate,
      },
    },
    include: {
      user: { select: { id: true, email: true, username: true } },
      channel: { select: { id: true, name: true } },
    },
  });
};

// Get subscription stats
export const getSubscriptionStats = async () => {
  const [total, active, cancelled, expired] = await Promise.all([
    prisma.subscription.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "CANCELLED" } }),
    prisma.subscription.count({ where: { status: "EXPIRED" } }),
  ]);

  return { total, active, cancelled, expired };
};

// Get top channels by subscriber count
export const getTopChannelsBySubscribers = async (limit: number = 10) => {
  const channelCounts = await prisma.subscription.groupBy({
    by: ["channelId"],
    where: { status: "ACTIVE" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });

  const channelIds = channelCounts.map((c) => c.channelId);
  const channels = await prisma.channel.findMany({
    where: { id: { in: channelIds } },
  });

  const channelMap = new Map(channels.map((c) => [c.id, c]));

  return channelCounts.map((c) => ({
    channel: channelMap.get(c.channelId),
    subscriberCount: c._count.id,
  }));
};
