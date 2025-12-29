import { prisma } from "@configs/database.config";
import { ChatMessageStatus } from "@generated/prisma/client";
import { PaginationParams, PaginatedResult } from "@types";

// Create chat message
export const createChatMessage = async (data: {
  streamId: string;
  userId: string;
  message: string;
  isHighlighted?: boolean;
  isPinned?: boolean;
  replyToId?: string;
}) => {
  return prisma.chatMessage.create({
    data: {
      streamId: data.streamId,
      userId: data.userId,
      message: data.message,
      isHighlighted: data.isHighlighted || false,
      isPinned: data.isPinned || false,
      replyToId: data.replyToId,
      status: "VISIBLE",
    },
    include: {
      user: {
        select: { id: true, username: true, imageUrl: true },
      },
      replyTo: {
        select: {
          id: true,
          message: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
  });
};

// Get chat message by ID
export const getChatMessageById = async (id: string) => {
  return prisma.chatMessage.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, username: true, imageUrl: true },
      },
      stream: {
        select: { id: true, channelId: true },
      },
    },
  });
};

// Get chat messages for a stream (paginated, newest first)
export const getChatMessages = async (
  streamId: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 50 } = params;
  const skip = (page - 1) * limit;

  const whereClause = {
    streamId,
    status: "VISIBLE" as ChatMessageStatus,
  };

  const [data, total] = await Promise.all([
    prisma.chatMessage.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, username: true, imageUrl: true },
        },
        replyTo: {
          select: {
            id: true,
            message: true,
            user: { select: { id: true, username: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.chatMessage.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    data: data.reverse(), // Return in chronological order
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

// Get recent messages (for duplicate detection)
export const getRecentMessages = async (
  streamId: string,
  userId: string,
  limit: number = 5
): Promise<string[]> => {
  const messages = await prisma.chatMessage.findMany({
    where: {
      streamId,
      userId,
      status: "VISIBLE",
      createdAt: {
        gte: new Date(Date.now() - 60000), // Last minute
      },
    },
    select: { message: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return messages.map((m) => m.message);
};

// Update chat message status
export const updateChatMessageStatus = async (
  id: string,
  status: ChatMessageStatus
) => {
  return prisma.chatMessage.update({
    where: { id },
    data: { status },
  });
};

// Delete chat message (soft delete - change status to DELETED)
export const deleteChatMessage = async (id: string) => {
  return prisma.chatMessage.update({
    where: { id },
    data: { status: "DELETED" },
  });
};

// Flag chat message for review
export const flagChatMessage = async (id: string) => {
  return prisma.chatMessage.update({
    where: { id },
    data: { status: "FLAGGED" },
  });
};

// Pin a chat message
export const pinChatMessage = async (id: string, isPinned: boolean) => {
  return prisma.chatMessage.update({
    where: { id },
    data: { isPinned },
  });
};

// Highlight a chat message
export const highlightChatMessage = async (id: string, isHighlighted: boolean) => {
  return prisma.chatMessage.update({
    where: { id },
    data: { isHighlighted },
  });
};

// Get pinned messages for a stream
export const getPinnedMessages = async (streamId: string) => {
  return prisma.chatMessage.findMany({
    where: {
      streamId,
      isPinned: true,
      status: "VISIBLE",
    },
    include: {
      user: {
        select: { id: true, username: true, imageUrl: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

// Get messages by user in a stream
export const getChatMessagesByUser = async (
  streamId: string,
  userId: string,
  params: PaginationParams = {}
): Promise<PaginatedResult<any>> => {
  const { page = 1, limit = 50 } = params;
  const skip = (page - 1) * limit;

  const whereClause = { streamId, userId };

  const [data, total] = await Promise.all([
    prisma.chatMessage.findMany({
      where: whereClause,
      include: {
        user: {
          select: { id: true, username: true, imageUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.chatMessage.count({ where: whereClause }),
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

// Delete all messages from a user in a stream
export const deleteUserMessagesInStream = async (
  streamId: string,
  userId: string
): Promise<number> => {
  const result = await prisma.chatMessage.updateMany({
    where: { streamId, userId },
    data: { status: "DELETED" },
  });

  return result.count;
};

// Get message count for a stream
export const getMessageCount = async (streamId: string): Promise<number> => {
  return prisma.chatMessage.count({
    where: { streamId, status: "VISIBLE" },
  });
};

// Delete old chat messages (for cleanup job)
export const deleteOldChatMessages = async (
  olderThan: Date,
  excludeVodStreams: boolean = true
): Promise<number> => {
  // First, get stream IDs that have VODs (if excluding)
  let excludeStreamIds: string[] = [];

  if (excludeVodStreams) {
    const streamsWithVod = await prisma.liveStream.findMany({
      where: {
        vodVideoId: { not: null },
      },
      select: { id: true },
    });
    excludeStreamIds = streamsWithVod.map((s) => s.id);
  }

  const result = await prisma.chatMessage.deleteMany({
    where: {
      createdAt: { lt: olderThan },
      stream: {
        endedAt: { lt: olderThan },
        ...(excludeStreamIds.length > 0
          ? { id: { notIn: excludeStreamIds } }
          : {}),
      },
    },
  });

  return result.count;
};
