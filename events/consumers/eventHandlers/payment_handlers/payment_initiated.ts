import * as paymentService from "@services/payment.service";
import logger from "@utils/logger";

interface PaymentInitiatedPayload {
  userId: string;
  amount: number;
  phoneNumber: string;
  checkoutRequestId: string;
  merchantRequestId: string;
  timestamp: string;
}

export const handlePaymentInitiated = async (
  payload: PaymentInitiatedPayload,
): Promise<void> => {
  try {
    const {
      userId,
      amount,
      phoneNumber,
      checkoutRequestId,
      merchantRequestId,
    } = payload;

    logger.info(`💳 Processing payment initiation for user ${userId}`);

    await paymentService.initiatePayment({
      userId,
      amount,
      phoneNumber,
      checkoutRequestId,
      merchantRequestId,
    });

    logger.info(`💫 Payment transaction created: ${checkoutRequestId}`);
  } catch (error) {
    logger.error("Failed to process payment initiation:", error);
    throw error;
  }
};
