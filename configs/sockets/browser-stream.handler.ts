import { Namespace, Socket } from "socket.io";
import * as browserStreamService from "@services/browser-stream.service";
import { verifyToken } from "@helpers/generate-token.helper";
import logger from "@utils/logger";

export const initBrowserStreamHandler = (namespace: Namespace) => {
  namespace.on("connection", async (socket: Socket) => {
    logger.debug(`Browser stream socket connected: ${socket.id}`);

    socket.on("start-stream", async (data: { streamKey: string; token?: string }) => {
      const { streamKey, token } = data;

      if (!streamKey) {
        socket.emit("error", { code: 4000, message: "Stream key required" });
        socket.disconnect();
        return;
      }

      if (token) {
        try {
          const decoded = await verifyToken(token);
          if (!decoded) {
            socket.emit("error", { code: 4001, message: "Invalid token" });
            socket.disconnect();
            return;
          }
          logger.debug(`Browser stream authenticated: ${decoded.id}`);
        } catch {
          socket.emit("error", { code: 4001, message: "Invalid token" });
          socket.disconnect();
          return;
        }
      }

      await browserStreamService.handleBrowserStream(socket, streamKey);
    });

    socket.on("disconnect", () => {
      logger.debug(`Browser stream socket disconnected: ${socket.id}`);
    });
  });
};

export const getMetrics = async () => ({
  activeStreams: await browserStreamService.getActiveStreamCount(),
});

export const shutdown = async () => {
  await browserStreamService.stopAllBrowserStreams();
};
