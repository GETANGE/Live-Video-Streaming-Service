import { Request, Response, NextFunction } from "express";
import { getAuthAccessToken, sendSTKPUSH_request } from "api/mpesa.api";
import * as paymentService from "@services/payment.service";
import { MpesaCallbackBody } from "@types";
import { createSTKPUSH_request } from "@helpers/payment.helper";
import APIError from "@utils/APIError";
import logger from "@utils/logger";

export const initiateSTK_push = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const { amount, phoneNumber } = req.body;

    if (!amount || !phoneNumber) {
      throw new APIError("Amount and phone number are required", 400);
    }

    // Get access token
    const accessToken = await getAuthAccessToken();

    // Generate timestamp and password
    const timestamp = paymentService.generateTimestamp();
    const password = paymentService.generatePassword(timestamp);
    
    console.log(`🧑‍🦱 Initiating STK Push for user ${userId} timestamp ${timestamp} password ${password}`);

    // Prepare STK Push request
    const stkRequest = await createSTKPUSH_request(
      timestamp,
      password,
      amount,
      phoneNumber,
      userId,
    );

    // Send STK Push request
    const response = await sendSTKPUSH_request(stkRequest, accessToken);

    // Create pending transaction
    await paymentService.initiatePayment({
      userId,
      amount,
      phoneNumber,
      checkoutRequestId: response.CheckoutRequestID,
      merchantRequestId: response.MerchantRequestID,
    });

    res.status(200).json({
      success: true,
      message: "STK Push sent. Please check your phone to complete payment.",
      data: {
        checkoutRequestId: response.CheckoutRequestID,
        merchantRequestId: response.MerchantRequestID,
      },
    });
  } catch (error) {
    logger.error("STK Push initiation error:", error);
    next(error);
  }
};

export const handleSTK_push_callback = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const callbackData: MpesaCallbackBody = req.body;

    logger.info("M-Pesa callback received:", JSON.stringify(callbackData));

    // Extract the STK callback data
    const stkCallback = callbackData.Body.stkCallback;

    // Process the callback
    await paymentService.processCallback(stkCallback);

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback received successfully",
    });
  } catch (error) {
    logger.error("M-Pesa callback error:", error);
    // respond with 200 to prevent M-Pesa retries
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback received",
    });
  }
};

export const paymentTransaction_history = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401);

    const [payments, transactions] = await Promise.all([
      paymentService.getPaymentHistory(userId),
      paymentService.getTransactionHistory(userId),
    ]);

    res.status(200).json({
      success: true,
      data: {
        payments,
        transactions,
      },
    });
  } catch (error) {
    logger.error("Payment history error:", error);
    next(error);
  }
};
