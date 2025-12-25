import { mpesaConfig } from "@constants/constant";
import * as paymentRepo from "@repository/payment.repository";
import * as subscriptionService from "@services/subscription.service";
import { emitNotification } from "@configs/socket.config";
import {
  getPendingSubscription,
  removePendingSubscription,
} from "@helpers/pendingSubscription.cache";
import { MpesaSTKCallback, ProcessedCallbackResult } from "@types";
import logger from "@utils/logger";

export const generatePassword = (timestamp: string): string => {
  const { passkey, shortCode } = mpesaConfig;
  const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString(
    "base64",
  );
  return password;
};

export const generateTimestamp = (): string => {
  const date = new Date();
  const pad = (num: number) => num.toString().padStart(2, "0");

  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

// Extract metadata from M-Pesa callback
const extractCallbackMetadata = (callback: MpesaSTKCallback) => {
  const metadata: Record<string, string | number> = {};

  if (callback.CallbackMetadata?.Item) {
    for (const item of callback.CallbackMetadata.Item) {
      metadata[item.Name] = item.Value;
    }
  }

  return {
    amount: metadata.Amount as number,
    mpesaReceiptNumber: metadata.MpesaReceiptNumber as string,
    transactionDate: metadata.TransactionDate as number,
    phoneNumber: metadata.PhoneNumber as string,
  };
};

// Handle successful payment
const handleSuccessfulPayment = async (
  callbackData: MpesaSTKCallback,
  transaction: { userId: string; amount: number },
): Promise<ProcessedCallbackResult> => {
  const { CheckoutRequestID, ResultCode, ResultDesc } = callbackData;
  const metadata = extractCallbackMetadata(callbackData);

  await paymentRepo.updateTransactionStatus(
    CheckoutRequestID,
    "COMPLETED",
    metadata.mpesaReceiptNumber,
  );

  const pendingSubscription = await getPendingSubscription(CheckoutRequestID);

  const payment = await paymentRepo.createPayment({
    userId: transaction.userId,
    amount: metadata.amount || transaction.amount,
    method: "mpesa",
    transactionId: metadata.mpesaReceiptNumber,
    channelId: pendingSubscription?.channelId,
    purpose: pendingSubscription ? "CHANNEL_SUBSCRIPTION" : undefined,
  });

  if (pendingSubscription) {
    await handleChannelSubscription(
      pendingSubscription,
      payment.id,
      CheckoutRequestID,
      transaction.userId,
      metadata,
    );
  } else {
    emitNotification(transaction.userId, {
      type: "PAYMENT_SUCCESS",
      message: `Payment of KES ${metadata.amount} received successfully`,
      mpesaReceiptNumber: metadata.mpesaReceiptNumber,
    });
  }

  logger.info(`Payment successful: ${metadata.mpesaReceiptNumber}`);

  return {
    success: true,
    transactionId: CheckoutRequestID,
    mpesaReceiptNumber: metadata.mpesaReceiptNumber,
    amount: metadata.amount,
    phoneNumber: String(metadata.phoneNumber),
    resultCode: ResultCode,
    resultDesc: ResultDesc,
  };
};

// Handle channel subscription after payment
const handleChannelSubscription = async (
  pendingSubscription: { userId: string; channelId: string; amount: number },
  paymentId: string,
  checkoutRequestId: string,
  transactionUserId: string,
  metadata: { amount: number; mpesaReceiptNumber: string },
): Promise<void> => {
  try {
    await subscriptionService.subscribeWithPayment(
      pendingSubscription.userId,
      pendingSubscription.channelId,
      paymentId,
      pendingSubscription.amount,
    );

    await removePendingSubscription(checkoutRequestId);

    logger.info(
      `Channel subscription created for user ${pendingSubscription.userId} to channel ${pendingSubscription.channelId}`,
    );

    emitNotification(transactionUserId, {
      type: "SUBSCRIPTION_SUCCESS",
      message: `You are now subscribed! Payment of KES ${metadata.amount} received.`,
      channelId: pendingSubscription.channelId,
      mpesaReceiptNumber: metadata.mpesaReceiptNumber,
    });
  } catch (error) {
    logger.error("Failed to create subscription after payment:", error);
    emitNotification(transactionUserId, {
      type: "SUBSCRIPTION_ERROR",
      message: `Payment received but subscription failed. Please contact support.`,
      mpesaReceiptNumber: metadata.mpesaReceiptNumber,
    });
  }
};

// Handle failed payment
const handleFailedPayment = async (
  checkoutRequestId: string,
  userId: string,
  resultCode: number,
  resultDesc: string,
): Promise<ProcessedCallbackResult> => {
  await paymentRepo.updateTransactionStatus(checkoutRequestId, "FAILED");

  const pendingSubscription = await getPendingSubscription(checkoutRequestId);
  if (pendingSubscription) {
    await removePendingSubscription(checkoutRequestId);
  }

  emitNotification(userId, {
    type: "PAYMENT_FAILED",
    message: `Payment failed: ${resultDesc}`,
  });

  logger.warn(`Payment failed: ${resultDesc}`);

  return {
    success: false,
    transactionId: checkoutRequestId,
    resultCode,
    resultDesc,
  };
};

// Main callback processor
export const processCallback = async (
  callbackData: MpesaSTKCallback,
): Promise<ProcessedCallbackResult> => {
  const { CheckoutRequestID, ResultCode, ResultDesc } = callbackData;

  logger.info(
    `Processing M-Pesa callback: ${CheckoutRequestID}, ResultCode: ${ResultCode}`,
  );

  try {
    const transaction =
      await paymentRepo.findTransactionByCheckoutId(CheckoutRequestID);

    if (!transaction) {
      logger.warn(
        `Transaction not found for CheckoutRequestID: ${CheckoutRequestID}`,
      );
      return {
        success: false,
        resultCode: ResultCode,
        resultDesc: "Transaction not found",
      };
    }

    if (ResultCode === 0) {
      return handleSuccessfulPayment(callbackData, transaction);
    }

    return handleFailedPayment(
      CheckoutRequestID,
      transaction.userId,
      ResultCode,
      ResultDesc,
    );
  } catch (error) {
    logger.error(`Error processing M-Pesa callback:`, error);
    throw error;
  }
};

// create a pending transaction after initiating STK Push.
export const initiatePayment = async (data: {
  userId: string;
  amount: number;
  phoneNumber: string;
  checkoutRequestId: string;
  merchantRequestId: string;
}) => {
  return paymentRepo.createTransaction({
    userId: data.userId,
    amount: data.amount,
    checkoutRequestId: data.checkoutRequestId,
    merchantRequestId: data.merchantRequestId,
    phoneNumber: data.phoneNumber,
  });
};

// Get user's payment history
export const getPaymentHistory = async (userId: string) => {
  return paymentRepo.getPaymentsByUserId(userId);
};

// Get user's transaction history
export const getTransactionHistory = async (userId: string) => {
  return paymentRepo.getTransactionsByUserId(userId);
};
