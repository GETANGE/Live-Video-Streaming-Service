import { emitNotification } from "@configs/socket.config";
import { StreamKeyNotificationPayload } from "@types";
import logger from "@utils/logger";

const emit = (
  eventType: string,
  message: string,
  payload: StreamKeyNotificationPayload
) => {
  const { userId, ...data } = payload;

  emitNotification(userId, {
    type: eventType,
    message,
    ...data,
    timestamp: new Date().toISOString(),
  });

  logger.debug(`Stream key notification sent to user ${userId}: ${eventType}`);
};

export const handleStreamKeyGenerated = async (
  payload: StreamKeyNotificationPayload
) => {
  emit(
    "STREAM_KEY_GENERATED",
    "New stream key generated for your channel",
    payload
  );
};

export const handleStreamKeyRevoked = async (
  payload: StreamKeyNotificationPayload
) => {
  emit("STREAM_KEY_REVOKED", "Stream key has been revoked", payload);
};

export const handleStreamKeyRotated = async (
  payload: StreamKeyNotificationPayload
) => {
  emit(
    "STREAM_KEY_ROTATED",
    "Stream key has been rotated. Update your streaming software",
    payload
  );
};

export const handleStreamKeyDeleted = async (
  payload: StreamKeyNotificationPayload
) => {
  emit("STREAM_KEY_DELETED", "Stream key has been deleted", payload);
};
