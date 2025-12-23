import logger from "@utils/logger";

interface RenewedPayload {
  subscriptionId: string;
  userId: string;
  channelId: string;
  timestamp: string;
}

export const handleSubscriptionRenewed = async (payload: RenewedPayload) => {
  try {
    const { subscriptionId, userId, channelId } = payload;

    // Note: Subscription renewal is handled automatically by the subscribe service
    // when reactivating an expired/cancelled subscription. This handler logs the event
    // for tracking purposes. Notifications are sent by the service.
    logger.info(`Subscription renewed: ${subscriptionId} for user ${userId} on channel ${channelId}`);
  } catch (error) {
    logger.error(`Failed to process subscription renewed:`, error);
    throw error;
  }
};
