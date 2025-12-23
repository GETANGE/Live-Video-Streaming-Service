import { prisma } from "@configs/database.config";
import { MarkReadPayload } from "@types";
import { emitNotification } from "@configs/socket.config";
import logger from "@utils/logger";


export const handleNotificationMarkRead = async (payload: MarkReadPayload) => {
  try {
    const { notificationId, userId } = payload;

    await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    await emitNotification(userId, {
      type: "NOTIFICATION_UPDATED",
      notificationId,
      isRead: true,
    });

    logger.info(`Notification ${notificationId} marked as read`);
  } catch (error) {
    logger.error("Failed to mark notification as read:", error);
    throw error;
  }
};