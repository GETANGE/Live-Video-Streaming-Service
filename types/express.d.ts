import { Redis } from "ioredis";

declare global {
  namespace Express {
    interface User {
      id: string;
      email?: string;
      isAdmin?: boolean;
    }
    interface Request {
      redisClient: Redis;
      user?: User;
    }
  }
}

export interface TokenPayload {
  id: string;
  email: string;
}

export interface UpdateProfilePayload {
  id: string;
  email?: string;
  username?: string;
  phoneNumber?: string;
}

// Pagination interfaces
export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    nextCursor?: string;
  };
}

// Subscription event payload
export interface SubscriptionEventPayload {
  subscriptionId: string;
  userId: string;
  channelId: string;
  status: string;
  timestamp: string;
}

export interface Subscription {
  id: string;
  userId: string;
  channelId: string;
  status: string;
  endDate?: Date | null;
  user?: { id: string } | null;
  channel?: { name: string } | null;
}

export interface UnsubscribePayload {
  userId: string;
  channelId: string;
  timestamp: string;
}

export interface MarkReadPayload {
  notificationId: string;
  userId: string;
}

export interface MarkAllReadPayload {
  userId: string;
}

export interface DeletePayload {
  notificationId: string;
  userId: string;
}

export interface MpesaConfig {
    shortCode: string;
    passkey: string;
    callbackUrl: string;
    transactionType: string;
}

export interface STKPushRequest {
    BusinessShortCode: string;
    Password: string;
    Timestamp: string;
    TransactionType: string;
    Amount: number;
    PartyA: string;
    PartyB: string;
    PhoneNumber: string;
    CallBackURL: string;
    AccountReference: string;
    TransactionDesc: string;
}

export interface TransactionCache {
    CheckoutRequestID: string;
    MerchantRequestID: string;
    Amount: number;
    PhoneNumber: string;
    status: Status;
}

// M-Pesa Callback Types
export interface MpesaCallbackMetadataItem {
  Name: string;
  Value: string | number;
}

export interface MpesaSTKCallback {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  CallbackMetadata?: {
    Item: MpesaCallbackMetadataItem[];
  };
}

export interface MpesaCallbackBody {
  Body: {
    stkCallback: MpesaSTKCallback;
  };
}

export interface ProcessedCallbackResult {
  success: boolean;
  transactionId?: string;
  mpesaReceiptNumber?: string;
  amount?: number;
  phoneNumber?: string;
  resultCode: number;
  resultDesc: string;
}

export interface VideoUploadedPayload {
  videoId: string;
  userId: string;
  channelId: string;
  title: string;
  description?: string;
  originalUrl: string;
  cdnUrl: string;
  thumbnailUrl: string;
  streamingUrl: string;
  publicId: string;
  timestamp: string;
}

export interface UploadResult {
  id: string;
  originalUrl: string;
  thumbnailUrl: string;
  streamingUrl: string;
  duration: number;
}

export interface VideoProcessPayload {
  videoId: string;
  userId: string;
  channelId: string;
  title: string;
  description?: string;
  fileName: string;
  timestamp: string;
}

export interface QualityPreset {
  name: string;
  width: number;
  height: number;
  bitrate: string;
  audioBitrate: string;
}

export {};
