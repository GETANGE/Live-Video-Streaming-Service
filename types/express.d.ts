import { Redis } from "ioredis";

declare global {
  namespace Express {
    interface User {
      id: string;
      email?: string;
      username?: string;
      imageUrl?: string | null;
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
  imageUrl?: string;
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

export interface VideoThumbnailPayload {
  videoId: string;
  userId: string;
  buffer: string; // base64 encoded
  mimetype: string;
  timestamp: string;
}

export interface VideoDeletePayload {
  videoId: string;
  userId: string;
  timestamp: string;
}

export interface TranscodeTask {
  inputPath: string;
  outputDir: string;
  preset: {
    name: string;
    width: number;
    height: number;
    bitrate: string;
    audioBitrate: string;
  };
  segmentDuration: number;
  duration: number; // Video duration in seconds for progress calculation
}

export interface WorkerResult {
  quality: string;
  success: boolean;
  error?: string;
}

export interface TranscodeTask {
  inputPath: string;
  outputDir: string;
  preset: {
    name: string;
    width: number;
    height: number;
    bitrate: string;
    audioBitrate: string;
  };
  segmentDuration: number;
  duration: number; // Video duration in seconds for progress calculation
}

// Channel payloads
export interface ChannelCreatedPayload {
  channelId: string;
  ownerId: string;
  name: string;
  description?: string;
  timestamp: string;
}

export interface ChannelUpdatedPayload {
  channelId: string;
  ownerId: string;
  name?: string;
  description?: string;
  timestamp: string;
}

export interface ChannelDeletedPayload {
  channelId: string;
  ownerId: string;
  timestamp: string;
}

export interface PendingSubscription {
  userId: string;
  channelId: string;
  amount: number;
  phoneNumber: string;
  createdAt: string;
}

// Livestreaming payload types
export interface StreamStartPayload {
  streamId: string;
  streamKey: string;
  channelId: string;
  streamerId: string;
  title?: string;
}

export interface StreamEndPayload {
  streamId: string;
  streamKey: string;
  channelId: string;
  streamerId: string;
  duration?: number;
}

export interface ChatMessagePayload {
  messageId: string;
  streamId: string;
  userId: string;
  username: string;
  message: string;
  timestamp: string;
}

export interface VodConvertPayload {
  streamId: string;
  channelId: string;
  streamerId: string;
  title?: string;
  duration?: number;
}

export interface ModerationActionPayload {
  streamId: string;
  moderatorId: string;
  targetUserId: string;
  action: "MUTE" | "BAN" | "WARN";
  reason?: string;
  expiresAt?: string;
}

export interface LiveTranscodeTask {
  streamId: string;
  inputUrl: string;
  outputDir: string;
  qualities: Array<{
    name: string;
    width: number;
    height: number;
    bitrate: string;
    audioBitrate: string;
  }>;
}

export interface RtmpSessionData {
  streamKey: string;
  channelId: string;
  userId: string;
  channelName: string;
  streamPath: string;
  status: string;
  startedAt: string;
}

export interface ActiveStream {
  ffmpeg: ChildProcess;
  socket: Socket;
  streamKey: string;
  startedAt: Date;
  bytesReceived: number;
}

export interface VodConvertPayload {
  streamId: string;
  channelId: string;
  streamerId: string;
  title?: string;
  duration?: number;
}

export interface ChatMessagePayload {
  streamId: string;
  userId: string;
  username: string;
  message: string;
  imageUrl?: string;
  flagged: boolean;
  messageId?: string;
}

export interface StreamStartPayload {
  streamId: string;
  streamKey: string;
  channelId: string;
  streamerId: string;
  title?: string;
}

export interface StreamEndPayload {
  streamId: string;
  streamKey: string;
  channelId: string;
  streamerId: string;
  duration?: number;
}

export interface ModerationPayload {
  streamId: string;
  moderatorId: string;
  targetUserId: string;
  action: "MUTE" | "BAN" | "WARN" | "UNBAN";
  reason?: string;
  expiresAt?: string;
  deleteMessages?: boolean;
}

export interface StreamKeyNotificationPayload {
  userId: string;
  channelId?: string;
  streamKeyId?: string;
  oldStreamKeyId?: string;
  newStreamKeyId?: string;
}

export interface NmsSession {
  reject: () => void;
}

export {};
