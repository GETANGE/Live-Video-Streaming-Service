import { createCircuitBreaker, getCircuitStats } from "@utils/circuitBreaker";
import logger from "@utils/logger";
import { STKPushRequest } from "@types";
import dotenv from "dotenv";

dotenv.config();

// Raw M-Pesa API functions (wrapped by circuit breakers)
const _getAuthAccessToken = async (): Promise<string> => {
  const secret =
    process.env.NODE_ENV === "production"
      ? process.env.MPESA_CONSUMER_SECRET
      : process.env.MPESA_CONSUMER_SECRET_TEST;

  const consumer =
    process.env.NODE_ENV === "production"
      ? process.env.MPESA_CONSUMER_KEY
      : process.env.MPESA_CONSUMER_KEY_TEST;

  const password = Buffer.from(`${consumer}:${secret}`).toString("base64");

  const response = await fetch(`${process.env.MPESA_AUTH_URL}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${password}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data: any = await response.json();

  logger.info("Mpesa access token retrieved successfully");

  return data.access_token;
};

const _sendSTKPUSH_request = async (
  requestBody: STKPushRequest,
  token: string,
) => {
  const response = await fetch(`${process.env.MPESA_STK_PUSH_URL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(`M-Pesa STK Push error: ${errorBody}`);
    throw new Error(`Failed to send STK push request: ${response.statusText}`);
  }

  const data: any = await response.json();

  logger.info("💫 STK push request sent successfully");

  return data;
};

// Circuit breakers for M-Pesa operations
const authBreaker = createCircuitBreaker(_getAuthAccessToken, {
  name: "MPesa:Auth",
  timeout: 15000, // 15s for auth
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // 30s reset
  volumeThreshold: 3,
});

const stkPushBreaker = createCircuitBreaker(_sendSTKPUSH_request, {
  name: "MPesa:STKPush",
  timeout: 30000, // 30s for STK push
  errorThresholdPercentage: 50,
  resetTimeout: 60000, // 1 minute reset (M-Pesa may have intermittent issues)
  volumeThreshold: 3,
});

// Public API functions (use circuit breakers)
export const getAuthAccessToken = async (): Promise<string> => {
  return authBreaker.fire();
};

export const sendSTKPUSH_request = async (
  requestBody: STKPushRequest,
  token: string,
) => {
  return stkPushBreaker.fire(requestBody, token);
};

// Get circuit breaker stats for monitoring
export const getMpesaCircuitStats = () => ({
  auth: getCircuitStats(authBreaker),
  stkPush: getCircuitStats(stkPushBreaker),
});
