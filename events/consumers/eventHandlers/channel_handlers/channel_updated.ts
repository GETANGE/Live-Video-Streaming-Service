import { prisma } from "@configs/database.config";
import { ChannelUpdatedPayload } from "@types";
import { notifyUser } from "@helpers/event.helper";
import logger from "@utils/logger";

export const handleChannelUpdated = async (
  payload: ChannelUpdatedPayload
): Promise<void> => {
  const { channelId, ownerId, name } = payload;

  try {
    logger.info(`📝 Processing channel updated: ${channelId}`);

    // Get all active subscribers to notify them
    const subscribers = await prisma.subscription.findMany({
      where: {
        channelId,
        status: "ACTIVE",
      },
      select: { userId: true },
    });

    // Create notifications for all subscribers
    if (subscribers.length > 0) {
      await prisma.notification.createMany({
        data: subscribers.map((sub) => ({
          userId: sub.userId,
          type: "INFO" as const,
          message: `Channel "${name}" has been updated`,
        })),
      });

      // Notify subscribers in real-time
      subscribers.forEach((sub) => {
        notifyUser(sub.userId, {
          type: "CHANNEL_UPDATED",
          message: `Channel "${name}" has been updated`,
          channelId,
        });
      });
    }

    logger.info(`✅ Channel updated event processed: ${channelId} (${subscribers.length} subscribers notified)`);
  } catch (error) {
    logger.error(`Failed to process channel updated event for ${channelId}:`, error);
    throw error;
  }
};
