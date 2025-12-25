import { prisma } from "@configs/database.config";
import { ChannelCreatedPayload } from "@types";
import { notifyUser } from "@helpers/event.helper";
import logger from "@utils/logger";

export const handleChannelCreated = async (
  payload: ChannelCreatedPayload
): Promise<void> => {
  const { channelId, ownerId, name } = payload;

  try {
    logger.info(`📺 Processing channel created: ${name} (${channelId})`);

    // Create welcome notification for channel owner
    await prisma.notification.create({
      data: {
        userId: ownerId,
        type: "INFO",
        message: `Your channel "${name}" has been created successfully!`,
      },
    });

    // Notify owner in real-time
    notifyUser(ownerId, {
      type: "CHANNEL_CREATED",
      message: `Channel "${name}" is now live!`,
      channelId,
    });

    logger.info(`✅ Channel created event processed: ${channelId}`);
  } catch (error) {
    logger.error(`Failed to process channel created event for ${channelId}:`, error);
    throw error;
  }
};
