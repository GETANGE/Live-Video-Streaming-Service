import { Namespace, Socket } from "socket.io";
import * as chatService from "@services/chat.service";
import { getUserByIdRepo } from "@repository/users.repository";
import { verifyToken } from "@helpers/generate-token.helper";
import logger from "@utils/logger";

export const initChatHandler = (namespace: Namespace) => {
  namespace.on("connection", async (socket: Socket) => {
    logger.debug(`Chat socket connected: ${socket.id}`);

    socket.data.userId = null;

    // Auto-authenticate from handshake auth token
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const decoded = await verifyToken(token);
        if (decoded) {
          socket.data.userId = decoded.id;
          socket.emit("authenticated", { success: true, userId: decoded.id });
          logger.debug(`Chat socket ${socket.id} auto-authenticated as ${decoded.id}`);
        }
      } catch {
        logger.debug(`Chat socket ${socket.id} auto-auth failed`);
      }
    }

    // Also support explicit authenticate event
    socket.on("authenticate", async (authToken: string) => {
      if (!authToken) {
        socket.emit("authenticated", { success: false, error: "Token required" });
        return;
      }

      try {
        const decoded = await verifyToken(authToken);
        if (!decoded) {
          socket.emit("authenticated", { success: false, error: "Invalid token" });
          return;
        }
        socket.data.userId = decoded.id;
        socket.emit("authenticated", { success: true, userId: decoded.id });
      } catch {
        socket.emit("authenticated", { success: false, error: "Token verification failed" });
      }
    });

    // Accept both string and object formats for join/leave
    socket.on("join-chat", (data: string | { streamId: string }) => {
      const streamId = typeof data === "string" ? data : data.streamId;
      socket.join(`chat:${streamId}`);
      logger.debug(`Socket ${socket.id} joined chat ${streamId}`);
    });

    socket.on("leave-chat", (data: string | { streamId: string }) => {
      const streamId = typeof data === "string" ? data : data.streamId;
      socket.leave(`chat:${streamId}`);
      logger.debug(`Socket ${socket.id} left chat ${streamId}`);
    });

    socket.on("send-message", async (data: { streamId: string; message: string }) => {
      if (!socket.data.userId) {
        socket.emit("error", { message: "Not authenticated" });
        return;
      }

      try {
        const user = await getUserByIdRepo(socket.data.userId);
        if (!user) {
          socket.emit("error", { message: "User not found" });
          return;
        }

        await chatService.sendMessage(
          data.streamId,
          socket.data.userId,
          user.username || user.email,
          data.message,
          user.imageUrl ?? undefined
        );
      } catch (error: any) {
        socket.emit("error", { message: error.message || "Failed to send message" });
      }
    });

    socket.on("typing", (streamId: string) => {
      if (socket.data.userId) {
        socket.to(`chat:${streamId}`).emit("user-typing", { userId: socket.data.userId });
      }
    });

    socket.on("stop-typing", (streamId: string) => {
      if (socket.data.userId) {
        socket.to(`chat:${streamId}`).emit("user-stop-typing", { userId: socket.data.userId });
      }
    });

    socket.on("disconnect", () => {
      logger.debug(`Chat socket disconnected: ${socket.id}`);
    });
  });
};
