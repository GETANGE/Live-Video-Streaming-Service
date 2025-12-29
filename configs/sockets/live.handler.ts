import { Namespace, Socket } from "socket.io";
import * as livestreamService from "@services/livestream.service";
import {
  addViewer,
  removeViewer,
  getSocketStreams,
  cleanupSocket,
  getViewerMetrics,
  invalidateViewerCache,
} from "@helpers/cacheInvalidations/viewerCacheInvalidation";
import logger from "@utils/logger";

export const initLiveHandler = (namespace: Namespace) => {
  namespace.on("connection", async (socket: Socket) => {
    logger.debug(`Live socket connected: ${socket.id}`);

    socket.on("get-active-streams", async () => {
      const activeStreams = await livestreamService.getActiveStreams();
      socket.emit("active-streams", activeStreams);
    });

    socket.on("join-stream", async (streamId: string) => {
      try {
        socket.join(`stream:${streamId}`);
        await addViewer(streamId, socket.id);

        const viewerCount = await livestreamService.joinStream(streamId);

        namespace.to(`stream:${streamId}`).emit("viewer-count", {
          streamId,
          count: viewerCount,
        });

        logger.debug(`Socket ${socket.id} joined stream ${streamId}`);
      } catch (error: any) {
        socket.emit("error", { message: error.message });
      }
    });

    socket.on("leave-stream", async (streamId: string) => {
      try {
        socket.leave(`stream:${streamId}`);
        await removeViewer(streamId, socket.id);

        const viewerCount = await livestreamService.leaveStream(streamId);

        namespace.to(`stream:${streamId}`).emit("viewer-count", {
          streamId,
          count: viewerCount,
        });

        logger.debug(`Socket ${socket.id} left stream ${streamId}`);
      } catch (error: any) {
        socket.emit("error", { message: error.message });
      }
    });

    socket.on("disconnect", async () => {
      const streams = await getSocketStreams(socket.id);

      for (const streamId of streams) {
        await removeViewer(streamId, socket.id);

        try {
          const viewerCount = await livestreamService.leaveStream(streamId);
          namespace.to(`stream:${streamId}`).emit("viewer-count", {
            streamId,
            count: viewerCount,
          });
        } catch (error) {
          logger.error(`Error decrementing viewer count: ${error}`);
        }
      }

      await cleanupSocket(socket.id);
      logger.debug(`Live socket disconnected: ${socket.id}`);
    });
  });
};

export const getMetrics = async () => {
  return getViewerMetrics();
};

export const clearAllViewers = async () => {
  await invalidateViewerCache();
};
