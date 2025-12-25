import * as channelRepo from "@repository/channel.repository";
import { PaginationParams } from "@types";
import APIError from "@utils/APIError";
import {
  publishChannelEvent,
  EVENT_TYPES,
} from "@helpers/event.helper";

// Create a new channel
export const createChannel = async (
  ownerId: string,
  data: {
    name: string;
    description?: string;
    isPaid?: boolean;
    subscriptionPrice?: number;
    currency?: string;
  }
) => {
  // Check if user already has a channel
  const existingChannel = await channelRepo.getChannelByOwner(ownerId);
  if (existingChannel) {
    throw new APIError("You already have a channel", 400);
  }

  // Check if channel name is taken
  const nameExists = await channelRepo.getChannelByName(data.name);
  if (nameExists) {
    throw new APIError("Channel name already taken", 400);
  }

  // Validate paid channel settings
  if (data.isPaid && (!data.subscriptionPrice || data.subscriptionPrice <= 0)) {
    throw new APIError("Paid channels must have a valid subscription price", 400);
  }

  const channel = await channelRepo.createChannel({
    name: data.name,
    description: data.description,
    ownerId,
    isPaid: data.isPaid,
    subscriptionPrice: data.subscriptionPrice,
    currency: data.currency,
  });

  // Publish channel created event
  await publishChannelEvent(EVENT_TYPES.CHANNEL_CREATED, {
    id: channel.id,
    ownerId,
    name: channel.name,
    description: channel.description || undefined,
  });

  return channel;
};

// Get channel by ID
export const getChannel = async (id: string) => {
  const channel = await channelRepo.getChannelById(id);
  if (!channel) {
    throw new APIError("Channel not found", 404);
  }
  return channel;
};

// Get channel by name
export const getChannelByName = async (name: string) => {
  const channel = await channelRepo.getChannelByName(name);
  if (!channel) {
    throw new APIError("Channel not found", 404);
  }
  return channel;
};

// Get user's channel
export const getMyChannel = async (ownerId: string) => {
  const channel = await channelRepo.getChannelByOwner(ownerId);
  if (!channel) {
    throw new APIError("You don't have a channel yet", 404);
  }
  return channel;
};

// Get all channels
export const getChannels = async (params: PaginationParams) => {
  return channelRepo.getChannels(params);
};

// Search channels
export const searchChannels = async (query: string, params: PaginationParams) => {
  return channelRepo.searchChannels(query, params);
};

// Update channel
export const updateChannel = async (
  channelId: string,
  userId: string,
  data: {
    name?: string;
    description?: string;
    isPaid?: boolean;
    subscriptionPrice?: number;
    currency?: string;
  }
) => {
  // Verify ownership
  const isOwner = await channelRepo.isChannelOwner(channelId, userId);
  if (!isOwner) {
    throw new APIError("You don't own this channel", 403);
  }

  // Check if new name is taken (if changing name)
  if (data.name) {
    const existing = await channelRepo.getChannelByName(data.name);
    if (existing && existing.id !== channelId) {
      throw new APIError("Channel name already taken", 400);
    }
  }

  // Validate paid channel settings
  if (data.isPaid && (!data.subscriptionPrice || data.subscriptionPrice <= 0)) {
    throw new APIError("Paid channels must have a valid subscription price", 400);
  }

  const channel = await channelRepo.updateChannel(channelId, data);

  // Publish channel updated event
  await publishChannelEvent(EVENT_TYPES.CHANNEL_UPDATED, {
    id: channel.id,
    ownerId: userId,
    name: channel.name,
    description: channel.description || undefined,
  });

  return channel;
};

// Delete channel (queued for async processing)
export const deleteChannel = async (channelId: string, userId: string) => {
  // Verify ownership
  const isOwner = await channelRepo.isChannelOwner(channelId, userId);
  if (!isOwner) {
    throw new APIError("You don't own this channel", 403);
  }

  // Publish channel deleted event (heavy operation - handled by video queue)
  await publishChannelEvent(EVENT_TYPES.CHANNEL_DELETED, {
    id: channelId,
    ownerId: userId,
  });

  // Return immediately - actual deletion happens in background
  return { queued: true, channelId };
};

// Get channel videos
export const getChannelVideos = async (
  channelId: string,
  params: PaginationParams
) => {
  // Verify channel exists
  const channel = await channelRepo.getChannelById(channelId);
  if (!channel) {
    throw new APIError("Channel not found", 404);
  }

  return channelRepo.getChannelVideos(channelId, params);
};

// Get channel stats
export const getChannelStats = async (channelId: string) => {
  const channel = await channelRepo.getChannelById(channelId);
  if (!channel) {
    throw new APIError("Channel not found", 404);
  }

  return channelRepo.getChannelStats(channelId);
};

// Get trending channels
export const getTrendingChannels = async (limit: number = 10) => {
  return channelRepo.getTrendingChannels(limit);
};
