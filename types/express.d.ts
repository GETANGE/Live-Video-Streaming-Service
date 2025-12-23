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

// Backpressure state management
export interface BackpressureState {
  inFlightCount: number;
  isPaused: boolean;
  consumerTag: string | null;
}

// System health status
export interface SystemHealth {
  database: {
    healthy: boolean;
    metrics: ReturnType<typeof getDatabaseMetrics>;
  };
  publisher: {
    healthy: boolean;
    metrics: ReturnType<typeof getPublisherMetrics>;
  };
  consumer: {
    healthy: boolean;
    metrics: ReturnType<typeof getBackpressureMetrics>;
  };
  socket: { healthy: boolean; metrics: ReturnType<typeof getSocketMetrics> };
  overall: boolean;
}

// Publisher backpressure state
export interface PublisherState {
  isBlocked: boolean;
  pendingMessages: Array<{
    payload: any;
    resolve: (value: PublishResult) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }>;
  drainHandler: (() => void) | null;
}

export interface PublishResult {
  success: boolean;
  queued: boolean;
  bufferLength: number;
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

export {};
