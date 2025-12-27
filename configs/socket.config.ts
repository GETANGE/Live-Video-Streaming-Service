import { Server as HTTPServer } from "http";
import logger from "@utils/logger";
import { Server as IOServer, Socket } from "socket.io";

let io: IOServer | null = null;

export const getSocketMetrics = () => ({
  connectedSockets: io?.sockets.sockets.size ?? 0,
});

export const initSocket = (server: HTTPServer) => {
  if (io) return;

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

  logger.info("Socket server initialized");
};

// Emit notification to user
export const emitNotification = (userId: string, notification: any): void => {
  if (!io) return;
  io.to(userId).emit("notification", notification);
};

// Emit video processing progress to user
export const emitVideoProgress = (
  userId: string,
  videoId: string,
  progress: {
    quality: string;
    percent: number;
    stage: "transcoding" | "uploading" | "complete" | "error";
  },
): void => {
  if (!io) return;
  io.to(userId).emit("video_progress", { videoId, ...progress });
};

// Emit profile picture upload progress to user
export const emitProfilePicProgress = (
  userId: string,
  progress: {
    percent: number;
    stage: "processing" | "uploading" | "complete" | "error";
    message?: string;
  },
): void => {
  if (!io) return;
  io.to(userId).emit("profile_pic_progress", { userId, ...progress });
};

// Graceful shutdown
export const shutdownSocket = () => {
  if (io) {
    io.close();
    io = null;
  }
  logger.info("Socket server shut down");
};

export default io;
