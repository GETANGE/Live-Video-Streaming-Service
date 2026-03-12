import * as livestreamRepo from "@repository/livestream.repository";
import * as channelRepo from "@repository/channel.repository";
import {
  getViewerCount,
  clearViewerCount,
} from "@helpers/cacheInvalidations/livestreamCacheInvalidation";
import APIError from "@utils/APIError";

export const generateRtmpUrl = (streamKey: string): string => {
  const host = process.env.RTMP_HOST || "localhost";
  return `rtmp://${host}:1935/live/${streamKey}`;
};

export const generateHlsUrl = (streamKey: string): string => {
  const baseUrl = process.env.HLS_BASE_URL || "http://localhost:8888";
  return `${baseUrl}/live/${streamKey}/index.m3u8`;
};

export const calculateDuration = (startedAt: Date | null): number => {
  if (!startedAt) return 0;
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
};

export const validateChannelOwnership = async (
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
  return channel;
};

export const validateStreamOwnership = async (
  streamId: string,
  userId: string
) => {
  const isOwner = await livestreamRepo.isStreamOwner(streamId, userId);
  if (!isOwner) {
    throw new APIError("You do not own this stream", 403);
  }
};

export const validateStreamExists = async (streamId: string) => {
  const stream = await livestreamRepo.getLiveStreamById(streamId);
  if (!stream) {
    throw new APIError("Stream not found", 404);
  }
  return stream;
};

export const validateStreamIsLive = async (streamId: string) => {
  const stream = await validateStreamExists(streamId);
  if (stream.status !== "LIVE") {
    throw new APIError("Stream is not live", 400);
  }
  return stream;
};

export const validateStreamNotLive = async (streamId: string) => {
  const stream = await validateStreamExists(streamId);
  if (stream.status === "LIVE") {
    throw new APIError("Stream is currently live", 400);
  }
  return stream;
};

export const validateStreamCanDelete = async (streamId: string) => {
  const stream = await validateStreamExists(streamId);
  if (stream.status === "LIVE") {
    throw new APIError("Cannot delete a live stream", 400);
  }
  if (stream.vodVideoId) {
    throw new APIError("Cannot delete stream with associated VOD", 400);
  }
  return stream;
};

export const validateStreamCanStart = async (streamKey: string) => {
  const stream = await livestreamRepo.getLiveStreamByStreamKey(streamKey);
  if (!stream) {
    throw new APIError("Stream not found", 404);
  }
  if (stream.status === "LIVE") {
    throw new APIError("Stream is already live", 400);
  }
  return stream;
};

export const prepareStreamEnd = async (streamId: string, userId?: string) => {
  const stream = await validateStreamIsLive(streamId);

  if (userId) {
    const isOwner = await livestreamRepo.isStreamOwner(streamId, userId);
    if (!isOwner) {
      throw new APIError("You do not own this stream", 403);
    }
  }

  const duration = calculateDuration(stream.startedAt);
  const finalViewerCount = await getViewerCount(streamId);

  return { stream, duration, finalViewerCount };
};

export const finalizeStreamEnd = async (
  streamId: string,
  currentPeakViewers: number,
  finalViewerCount: number
) => {
  if (finalViewerCount > currentPeakViewers) {
    await livestreamRepo.updatePeakViewers(streamId, finalViewerCount);
  }
  await clearViewerCount(streamId);
};

export const buildStreamStartPayload = (stream: {
  id: string;
  channelId: string;
  streamerId: string;
  title: string;
}) => ({
  eventType: "STREAM_START" as const,
  payload: {
    streamId: stream.id,
    channelId: stream.channelId,
    streamerId: stream.streamerId,
    title: stream.title,
  },
});

export const buildStreamEndPayload = (
  stream: { id: string; channelId: string; streamerId: string },
  duration: number
) => ({
  eventType: "STREAM_END" as const,
  payload: {
    streamId: stream.id,
    channelId: stream.channelId,
    streamerId: stream.streamerId,
    duration,
  },
});

export const buildVodConvertPayload = (
  stream: { id: string; channelId: string; title: string },
  duration: number
) => ({
  eventType: "VOD_CONVERT" as const,
  payload: {
    streamId: stream.id,
    channelId: stream.channelId,
    title: stream.title,
    duration,
  },
});
