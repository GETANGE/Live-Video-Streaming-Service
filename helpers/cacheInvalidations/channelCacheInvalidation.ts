import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

const CHANNEL_VERSION_KEY = "channel:version";

const channelKey = (version: string, key: string) =>
  `${CHANNEL_VERSION_KEY}:${key}:${version}`;

const getChannelVersion = async () => {
  let version = await redisClient.get(CHANNEL_VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(CHANNEL_VERSION_KEY, version);
  }
  return version;
};

export const getChannelCacheKeys = async () => {
  const version = await getChannelVersion();

  return {
    byId: (id: string) => channelKey(version, `id:${id}`),

    byName: (name: string) => channelKey(version, `name:${name}`),

    byOwner: (ownerId: string) => channelKey(version, `owner:${ownerId}`),

    videos: (channelId: string) => channelKey(version, `videos:${channelId}`),

    stats: (channelId: string) => channelKey(version, `stats:${channelId}`),

    trending: () => channelKey(version, `trending`),

    all: () => channelKey(version, `all`),
  };
};

export const invalidateChannelCache = async () => {
  await redisClient.incr(CHANNEL_VERSION_KEY);
  logger.info("🧹 Channel cache invalidated");
};
