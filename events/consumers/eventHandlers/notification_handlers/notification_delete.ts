import { prisma } from "@configs/database.config";
import { DeletePayload } from "@types";
import { emitNotification } from "@configs/socket.config";
import logger from "@utils/logger";


export const handleNotificationDelete = async (payload: DeletePayload) => {
  try {
    const { notificationId, userId } = payload;

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    await emitNotification(userId, {
      type: "NOTIFICATION_DELETED",
      notificationId,
    });

    logger.info(`Notification ${notificationId} deleted`);
  } catch (error) {
    logger.error("Failed to delete notification:", error);
    throw error;
  }
};
