import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const VERSION_KEY = "browserstream:version";
const CACHE_TTL = 86400;

const browserStreamCacheKey = (version: string, key: string) =>
  `browserstream:${version}:${key}`;

const getVersion = async (): Promise<string> => {
  let version = await redisClient.get(VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(VERSION_KEY, version);
  }
  return version;
};

export const getBrowserStreamCacheKeys = async () => {
  const version = await getVersion();

  return {
    stream: (streamKey: string) =>
      browserStreamCacheKey(version, `stream:${streamKey}`),
    activeStreams: () => browserStreamCacheKey(version, "active"),
  };
};

export const invalidateBrowserStreamCache = async (): Promise<void> => {
  await redisClient.incr(VERSION_KEY);
  logger.info("Browser stream cache invalidated (version incremented)");
};

export interface BrowserStreamData {
  streamKey: string;
  startedAt: string;
  bytesReceived: number;
  channelName?: string;
  serverId: string;
}

export const setActiveStream = async (
  streamKey: string,
  data: BrowserStreamData
): Promise<void> => {
  const keys = await getBrowserStreamCacheKeys();
  await redisClient.setex(
    keys.stream(streamKey),
    CACHE_TTL,
    JSON.stringify(data)
  );
  await redisClient.sadd(keys.activeStreams(), streamKey);
};

export const getActiveStream = async (
  streamKey: string
): Promise<BrowserStreamData | null> => {
  const keys = await getBrowserStreamCacheKeys();
  const cached = await redisClient.get(keys.stream(streamKey));
  if (!cached) return null;

  try {
    return JSON.parse(cached);
  } catch {
    return null;
  }
};

export const updateStreamBytes = async (
  streamKey: string,
  bytesReceived: number
): Promise<void> => {
  const stream = await getActiveStream(streamKey);
  if (stream) {
    stream.bytesReceived = bytesReceived;
    const keys = await getBrowserStreamCacheKeys();
    await redisClient.setex(
      keys.stream(streamKey),
      CACHE_TTL,
      JSON.stringify(stream)
    );
  }
};

export const removeActiveStream = async (streamKey: string): Promise<void> => {
  const keys = await getBrowserStreamCacheKeys();
  await redisClient.del(keys.stream(streamKey));
  await redisClient.srem(keys.activeStreams(), streamKey);
};

export const isStreamActive = async (streamKey: string): Promise<boolean> => {
  const keys = await getBrowserStreamCacheKeys();
  return (await redisClient.sismember(keys.activeStreams(), streamKey)) === 1;
};

export const getActiveStreamCount = async (): Promise<number> => {
  const keys = await getBrowserStreamCacheKeys();
  return redisClient.scard(keys.activeStreams());
};

export const getAllActiveStreamKeys = async (): Promise<string[]> => {
  const keys = await getBrowserStreamCacheKeys();
  return redisClient.smembers(keys.activeStreams());
};

export const getAllActiveStreams = async (): Promise<BrowserStreamData[]> => {
  const streamKeys = await getAllActiveStreamKeys();
  const streams: BrowserStreamData[] = [];

  for (const streamKey of streamKeys) {
    const stream = await getActiveStream(streamKey);
    if (stream) {
      streams.push(stream);
    }
  }

  return streams;
};
