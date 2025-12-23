import * as subscriptionService from "@services/subscription.service";
import logger from "@utils/logger";

interface ExpiredPayload {
  triggeredBy: string;
  timestamp: string;
}

export const handleSubscriptionExpired = async (payload: ExpiredPayload) => {
  try {
    const { triggeredBy } = payload;

    logger.info(`Processing expired subscriptions triggered by ${triggeredBy}`);

    const result = await subscriptionService.processExpiredSubscriptions();

    logger.info(`Processed ${result.count} expired subscriptions`);
  } catch (error) {
    logger.error(`Failed to process subscription expired:`, error);
    throw error;
  }
};
