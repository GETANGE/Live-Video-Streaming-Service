import { Server as IOServer } from "socket.io";
import {
  initLiveHandler,
  initChatHandler,
  initBrowserStreamHandler,
  getLiveMetrics,
  getBrowserMetrics,
  clearAllViewers,
  shutdownBrowserStream,
  setNamespaces,
} from "./sockets";
import logger from "@utils/logger";

let liveNamespace: ReturnType<IOServer["of"]> | null = null;
let chatNamespace: ReturnType<IOServer["of"]> | null = null;
let browserStreamNamespace: ReturnType<IOServer["of"]> | null = null;

export const initLiveSocket = (io: IOServer) => {
  liveNamespace = io.of("/live");
  chatNamespace = io.of("/chat");
  browserStreamNamespace = io.of("/browser-stream");

  initLiveHandler(liveNamespace);
  initChatHandler(chatNamespace);
  initBrowserStreamHandler(browserStreamNamespace);

  setNamespaces(liveNamespace, chatNamespace);

  logger.info("Live, Chat, and Browser Stream namespaces initialized");
};

export const getLiveSocketMetrics = async () => {
  const liveMetrics = await getLiveMetrics();
  return {
    liveConnections: liveNamespace?.sockets.size ?? 0,
    chatConnections: chatNamespace?.sockets.size ?? 0,
    browserStreamConnections: browserStreamNamespace?.sockets.size ?? 0,
    ...liveMetrics,
    ...getBrowserMetrics(),
  };
};

export const shutdownLiveSocket = async () => {
  liveNamespace?.disconnectSockets(true);
  chatNamespace?.disconnectSockets(true);
  browserStreamNamespace?.disconnectSockets(true);
  shutdownBrowserStream();
  await clearAllViewers();
  logger.info("Live sockets shut down");
};

export {
  emitStreamStart,
  emitStreamEnd,
  emitViewerCount,
  emitChatMessage,
  emitMessageDeleted,
  emitUserMuted,
  emitUserBanned,
  emitUserUnbanned,
} from "./sockets/emitters";
