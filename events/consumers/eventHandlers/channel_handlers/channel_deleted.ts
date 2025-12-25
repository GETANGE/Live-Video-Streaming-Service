import { prisma } from "@configs/database.config";
import { ChannelDeletedPayload } from "@types";
import { deleteVideo } from "@services/uploader.service";
import { notifyUser } from "@helpers/event.helper";
import logger from "@utils/logger";

export const handleChannelDeleted = async (
  payload: ChannelDeletedPayload
): Promise<void> => {
  const { channelId, ownerId } = payload;

  try {
    logger.info(`🗑️ Processing channel deletion: ${channelId}`);

    // Get channel info before deletion
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        name: true,
        ownerId: true,
        videos: { select: { id: true } },
        subscriptions: {
          where: { status: "ACTIVE" },
          select: { userId: true },
        },
      },
    });

    if (!channel) {
      logger.warn(`Channel ${channelId} not found, skipping deletion`);
      return;
    }

    // Verify ownership
    if (channel.ownerId !== ownerId) {
      logger.error(`User ${ownerId} not authorized to delete channel ${channelId}`);
      throw new Error("Unauthorized deletion attempt");
    }

    // Delete all channel videos from storage (MinIO/CDN)
    logger.info(`Deleting ${channel.videos.length} videos from channel ${channelId}`);
    for (const video of channel.videos) {
      try {
        await deleteVideo(video.id);
      } catch (err) {
        logger.warn(`Failed to delete video ${video.id} from storage:`, err);
      }
    }

    // Notify all subscribers before deletion
    const subscriberIds = channel.subscriptions.map((s) => s.userId);
    if (subscriberIds.length > 0) {
      // Create notifications for subscribers
      await prisma.notification.createMany({
        data: subscriberIds.map((userId) => ({
          userId,
          type: "ALERT" as const,
          message: `Channel "${channel.name}" has been deleted`,
        })),
      });

      // Real-time notifications
      subscriberIds.forEach((userId) => {
        notifyUser(userId, {
          type: "CHANNEL_DELETED",
          message: `Channel "${channel.name}" has been deleted`,
          channelId,
        });
      });
    }

    // Delete channel (cascades to videos, subscriptions due to Prisma relations)
    await prisma.channel.delete({
      where: { id: channelId },
    });

    // Notify owner
    notifyUser(ownerId, {
      type: "CHANNEL_DELETED",
      message: `Your channel "${channel.name}" has been deleted`,
      channelId,
    });

    logger.info(`✅ Channel deleted: ${channelId} (${channel.videos.length} videos, ${subscriberIds.length} subscribers)`);
  } catch (error) {
    logger.error(`Failed to process channel deletion for ${channelId}:`, error);
    throw error;
  }
};
