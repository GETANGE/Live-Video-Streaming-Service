import * as livestreamRepo from "@repository/livestream.repository";
import * as streamKeyRepo from "@repository/streamkey.repository";
import { incrementViewerCount, decrementViewerCount, getViewerCount } from "@helpers/cacheInvalidations/livestreamCacheInvalidation";
import {
  generateRtmpUrl,
  generateHlsUrl,
  validateChannelOwnership,
  validateStreamOwnership,
  validateStreamExists,
  validateStreamIsLive,
  validateStreamCanDelete,
  validateStreamCanStart,
  prepareStreamEnd,
  finalizeStreamEnd,
  buildStreamStartPayload,
  buildStreamEndPayload,
  buildVodConvertPayload,
} from "@helpers/livestream.helper";
import { publishMessage } from "@events/producers/streaming.publisher";
import logger from "@utils/logger";
import { PaginationParams } from "@types";

export const createStream = async (
  userId: string,
  channelId: string,
  data: { title: string; description?: string; scheduledStart?: Date }
) => {
  await validateChannelOwnership(channelId, userId);

  const streamKey = await streamKeyRepo.createStreamKey({
    userId,
    channelId,
    label: `Stream: ${data.title.substring(0, 20)}`,
  });

  const stream = await livestreamRepo.createLiveStream({
    title: data.title,
    description: data.description,
    channelId,
    streamerId: userId,
    streamKey: streamKey.key,
    scheduledStart: data.scheduledStart,
  });

  logger.info(`Livestream created: ${stream.id}`);

  return {
    ...stream,
    streamKey: streamKey.key,
    rtmpUrl: generateRtmpUrl(streamKey.key),
  };
};

export const startStream = async (streamKey: string) => {
  const stream = await validateStreamCanStart(streamKey);

  const updatedStream = await livestreamRepo.updateLiveStream(stream.id, {
    status: "LIVE",
    startedAt: new Date(),
    hlsUrl: generateHlsUrl(streamKey),
  });

  await publishMessage(buildStreamStartPayload(stream));

  logger.info(`Stream started: ${stream.id}`);
  return updatedStream;
};

export const endStream = async (streamId: string, userId?: string) => {
  const { stream, duration, finalViewerCount } = await prepareStreamEnd(
    streamId,
    userId
  );

  const updatedStream = await livestreamRepo.updateLiveStream(streamId, {
    status: "ENDED",
    endedAt: new Date(),
    duration,
    currentViewers: 0,
  });

  await finalizeStreamEnd(streamId, stream.peakViewers, finalViewerCount);
  await publishMessage(buildStreamEndPayload(stream, duration));
  await publishMessage(buildVodConvertPayload(stream, duration));

  logger.info(`Stream ended: ${streamId} (duration: ${duration}s)`);
  return updatedStream;
};

export const endStreamByKey = async (streamKey: string) => {
  const stream = await livestreamRepo.getLiveStreamByStreamKey(streamKey);
  if (!stream) throw new Error("Stream not found");
  return endStream(stream.id);
};

export const getStream = async (streamId: string) => {
  return validateStreamExists(streamId);
};

export const getLiveStreams = async (params: PaginationParams) => {
  return livestreamRepo.getLiveStreams(params);
};

export const getActiveLiveStreams = async (params: PaginationParams) => {
  return livestreamRepo.getActiveLiveStreams(params);
};

export const getActiveStreams = async (limit: number = 50) => {
  const result = await livestreamRepo.getActiveLiveStreams({ page: 1, limit });
  return result.data;
};

export const getChannelStreams = async (
  channelId: string,
  params: PaginationParams
) => {
  return livestreamRepo.getChannelLiveStreams(channelId, params);
};

export const getMyStreams = async (userId: string, params: PaginationParams) => {
  return livestreamRepo.getStreamerLiveStreams(userId, params);
};

export const joinStream = async (streamId: string): Promise<number> => {
  await validateStreamIsLive(streamId);

  const newCount = await incrementViewerCount(streamId);
  await livestreamRepo.incrementTotalViews(streamId);
  await livestreamRepo.updatePeakViewers(streamId, newCount);

  logger.debug(`Viewer joined stream ${streamId}: ${newCount} viewers`);
  return newCount;
};

export const leaveStream = async (streamId: string): Promise<number> => {
  const newCount = await decrementViewerCount(streamId);
  logger.debug(`Viewer left stream ${streamId}: ${newCount} viewers`);
  return newCount;
};

export const getStreamViewerCount = async (streamId: string): Promise<number> => {
  return getViewerCount(streamId);
};

export const updateStream = async (
  streamId: string,
  userId: string,
  data: { title?: string; description?: string; thumbnailUrl?: string }
) => {
  await validateStreamOwnership(streamId, userId);
  const stream = await livestreamRepo.updateLiveStream(streamId, data);
  logger.info(`Stream updated: ${streamId}`);
  return stream;
};

export const getStreamStats = async (streamId: string) => {
  return livestreamRepo.getStreamStats(streamId);
};

export const deleteStream = async (streamId: string, userId: string) => {
  await validateStreamCanDelete(streamId);
  await validateStreamOwnership(streamId, userId);
  await livestreamRepo.deleteLiveStream(streamId);
  logger.info(`Stream deleted: ${streamId}`);
  return { deleted: true };
};
