import { Server as HTTPServer } from "http";
import logger from "@utils/logger";
import { Server as IOServer, Socket } from "socket.io";

let io: IOServer | null = null;

// Backpressure configuration
const NOTIFICATION_QUEUE_LIMIT = 1000;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 100;
const HIGH_WATER_MARK = 16 * 1024; // 16KB buffer threshold per socket

// Notification queue for backpressure handling
interface QueuedNotification {
  userId: string;
  notification: any;
  timestamp: number;
}

const notificationQueue: QueuedNotification[] = [];
let isProcessingQueue = false;
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

// Track socket buffer states for backpressure
const socketBackpressureState = new Map<
  string,
  { isPaused: boolean; droppedCount: number }
>();

// Get socket backpressure metrics
export const getSocketMetrics = () => ({
  queueLength: notificationQueue.length,
  queueLimit: NOTIFICATION_QUEUE_LIMIT,
  isProcessing: isProcessingQueue,
  connectedSockets: io?.sockets.sockets.size ?? 0,
  backpressuredSockets: Array.from(socketBackpressureState.entries())
    .filter(([_, state]) => state.isPaused)
    .map(([id]) => id),
});

// Check if a socket is under backpressure
const isSocketUnderBackpressure = (socket: Socket): boolean => {
  // Check the socket's write buffer
  const transport = socket.conn?.transport;
  if (transport && "writable" in transport) {
    // @ts-ignore - accessing internal property
    const writeBuffer = transport.writable;
    if (writeBuffer === false) {
      return true;
    }
  }
  // Check buffered amount
  // @ts-ignore - accessing internal buffer size
  const bufferSize = socket.conn?.transport?.socket?.bufferedAmount ?? 0;
  return bufferSize > HIGH_WATER_MARK;
};

// Process notification queue in batches
const processNotificationQueue = async () => {
  if (isProcessingQueue || notificationQueue.length === 0 || !io) return;

  isProcessingQueue = true;

  try {
    const batch = notificationQueue.splice(0, BATCH_SIZE);

    for (const { userId, notification } of batch) {
      const sockets = await io.in(userId).fetchSockets();

      for (const socket of sockets) {
        const state = socketBackpressureState.get(socket.id) || {
          isPaused: false,
          droppedCount: 0,
        };

        // @ts-ignore - Socket type compatibility
        if (isSocketUnderBackpressure(socket)) {
          if (!state.isPaused) {
            logger.warn(
              `⏸️  Socket backpressure: Pausing notifications for ${socket.id}`
            );
            state.isPaused = true;
          }
          state.droppedCount++;
          socketBackpressureState.set(socket.id, state);
          continue;
        }

        if (state.isPaused) {
          logger.info(
            `▶️  Socket backpressure: Resuming notifications for ${socket.id} (dropped: ${state.droppedCount})`
          );
          state.isPaused = false;
          state.droppedCount = 0;
        }

        socketBackpressureState.set(socket.id, state);
        socket.emit("new_notification", notification);
      }
    }
  } catch (error) {
    logger.error("Error processing notification queue:", error);
  } finally {
    isProcessingQueue = false;
  }
};

// Start the queue flush interval
const startQueueProcessor = () => {
  if (flushIntervalId) return;

  flushIntervalId = setInterval(() => {
    processNotificationQueue();
  }, FLUSH_INTERVAL_MS);

  logger.info("🔄 Notification queue processor started");
};

// Stop the queue flush interval
const stopQueueProcessor = () => {
  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
    logger.info("⏹️  Notification queue processor stopped");
  }
};

export const initSocket = (server: HTTPServer) => {
  if (io) return;

  io = new IOServer(server, {
    // Socket.IO backpressure settings
    perMessageDeflate: {
      threshold: 1024, // Only compress messages > 1KB
    },
    maxHttpBufferSize: 1e6, // 1MB max message size
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on("connection", (socket: Socket) => {
    logger.info("A user connected:", socket.id);

    // Initialize backpressure state for this socket
    socketBackpressureState.set(socket.id, {
      isPaused: false,
      droppedCount: 0,
    });

    // Handle drain event (buffer emptied - can resume sending)
    socket.conn?.on("drain", () => {
      const state = socketBackpressureState.get(socket.id);
      if (state?.isPaused) {
        logger.info(`💧 Socket drain: Buffer cleared for ${socket.id}`);
      }
    });

    socket.on("disconnect", () => {
      logger.info("A user disconnected:", socket.id);
      socketBackpressureState.delete(socket.id);
    });
  });

  io.on("error", (error: Error) => {
    logger.error("Socket error:", error);
  });

  // Start queue processor
  startQueueProcessor();

  logger.info(`🔌 Socket server initialized with backpressure support`);
};

// Emit notification with backpressure handling
export const emitNotification = async (
  userId: string,
  notification: any
): Promise<{ queued: boolean; queueLength: number }> => {
  if (!io) {
    logger.error(`Socket server not initialized; skipping emit.`);
    return { queued: false, queueLength: 0 };
  }

  // Check queue capacity (backpressure)
  if (notificationQueue.length >= NOTIFICATION_QUEUE_LIMIT) {
    logger.warn(
      `⚠️  Notification queue full (${NOTIFICATION_QUEUE_LIMIT}). Dropping oldest notification.`
    );
    notificationQueue.shift(); // Drop oldest to make room (could also reject new)
  }

  // Add to queue for batch processing
  notificationQueue.push({
    userId,
    notification,
    timestamp: Date.now(),
  });

  // Trigger immediate processing if queue is getting large
  if (notificationQueue.length >= BATCH_SIZE) {
    setImmediate(() => processNotificationQueue());
  }

  return { queued: true, queueLength: notificationQueue.length };
};

// Emit notification immediately (bypasses queue, for critical notifications)
export const emitNotificationImmediate = async (
  userId: string,
  notification: any
): Promise<boolean> => {
  if (!io) {
    logger.error(`Socket server not initialized; skipping emit.`);
    return false;
  }

  const sockets = await io.in(userId).fetchSockets();
  let sent = false;

  for (const socket of sockets) {
    // @ts-ignore - Socket type compatibility
    if (!isSocketUnderBackpressure(socket)) {
      socket.emit("new_notification", notification);
      sent = true;
    }
  }

  return sent;
};

// Graceful shutdown
export const shutdownSocket = async () => {
  stopQueueProcessor();

  // Process remaining notifications
  while (notificationQueue.length > 0) {
    await processNotificationQueue();
  }

  if (io) {
    io.close();
    io = null;
  }

  logger.info("🔌 Socket server shut down gracefully");
};

export default io;
