import { Redis } from "ioredis";

declare global {
  namespace Express {
    interface Request {
      redisClient: Redis;
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

export {};
