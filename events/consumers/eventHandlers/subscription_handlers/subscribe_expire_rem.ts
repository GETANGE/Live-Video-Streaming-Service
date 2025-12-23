import * as subscriptionService from "@services/subscription.service";
import logger from "@utils/logger";

interface ExpiringSoonPayload {
  daysBeforeExpiry: number;
  triggeredBy: string;
  timestamp: string;
}

export const handleSubscriptionExpiringSoon = async (payload: ExpiringSoonPayload) => {
  try {
    const { daysBeforeExpiry, triggeredBy } = payload;

    logger.info(`Processing expiration reminders for subscriptions expiring in ${daysBeforeExpiry} days, triggered by ${triggeredBy}`);

    const count = await subscriptionService.sendExpirationReminders(daysBeforeExpiry);

    logger.info(`Sent ${count} expiration reminders`);
  } catch (error) {
    logger.error(`Failed to process subscription expiring soon:`, error);
    throw error;
  }
};
