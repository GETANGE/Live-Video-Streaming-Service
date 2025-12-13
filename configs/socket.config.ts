import { Server as HTTPServer } from "http";
import logger from "@utils/logger";
import { Server as IOServer, Socket } from "socket.io";

let io: IOServer | null = null;

export const initSocket = (server: HTTPServer) => {
  if (io) return;
  io = new IOServer(server);

  io.on("connection", (socket: Socket) => {
    logger.info("A user connected:", socket.id);
  });

  io.on("disconnect", (socket: Socket) => {
    logger.info("A user disconnected:", socket.id);
  });

  io.on("error", (error: Error) => {
    logger.error("Socket error:", error);
  });

  logger.info(`🔌 Socket server initialized`);
};

export const emitNotification = async (userId: string, notification: any) => {
  if (!io) {
    logger.error(`Socket server not initialized; skipping emit.`);
    return;
  }

  io.to(userId).emit("new_notification", notification);
};

export default io;
