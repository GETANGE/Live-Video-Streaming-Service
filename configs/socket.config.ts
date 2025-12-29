import { Server as HTTPServer } from "http";
import { Server as IOServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import redisClient from "@configs/redis.config";
import logger from "@utils/logger";

let io: IOServer | null = null;

export const getSocketMetrics = () => ({
  connectedSockets: io?.sockets.sockets.size ?? 0,
});

export const initSocket = (server: HTTPServer): IOServer => {
  if (io) return io;

  io = new IOServer(server, {
    cors: {
      origin: true,
      methods: ["GET", "POST"],
      credentials: true,
    },
    maxHttpBufferSize: 1e6,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.on("connection", (socket: Socket) => {
    logger.info(`User connected: ${socket.id}`);

    socket.on("join", (userId: string) => {
      socket.join(userId);
      logger.debug(`Socket ${socket.id} joined room ${userId}`);
    });

    socket.on("disconnect", () => {
      logger.info(`User disconnected: ${socket.id}`);
    });
  });

  io.on("error", (error: Error) => {
    logger.error("Socket error:", error);
  });

  logger.info("Socket.IO initialized with Redis adapter");
  return io;
};

export const getIO = (): IOServer | null => io;

export const emitNotification = async (userId: string, notification: any): Promise<void> => {
  if (!io) return;
  io.to(userId).emit("notification", notification);
};

export const emitVideoProgress = (
  userId: string,
  videoId: string,
  progress: {
    quality: string;
    percent: number;
    stage: "transcoding" | "uploading" | "complete" | "error";
  }
): void => {
  if (!io) return;
  io.to(userId).emit("video_progress", { videoId, ...progress });
};

export const emitProfilePicProgress = (
  userId: string,
  progress: {
    percent: number;
    stage: "processing" | "uploading" | "complete" | "error";
    message?: string;
  }
): void => {
  if (!io) return;
  io.to(userId).emit("profile_pic_progress", { userId, ...progress });
};

export const shutdownSocket = () => {
  if (io) {
    io.close();
    io = null;
  }
  logger.info("Socket server shut down");
};
