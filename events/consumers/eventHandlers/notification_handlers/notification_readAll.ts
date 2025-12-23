import { prisma } from "@configs/database.config";
import { MarkAllReadPayload } from "@types";
import { emitNotification } from "@configs/socket.config";
import logger from "@utils/logger";


export const handleNotificationMarkAllRead = async (payload: MarkAllReadPayload) => {
  try {
    const { userId } = payload;

    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    await emitNotification(userId, {
      type: "ALL_NOTIFICATIONS_READ",
      count: result.count,
    });

    logger.info(`Marked ${result.count} notifications as read for user ${userId}`);
  } catch (error) {
    logger.error("Failed to mark all notifications as read:", error);
    throw error;
  }
};