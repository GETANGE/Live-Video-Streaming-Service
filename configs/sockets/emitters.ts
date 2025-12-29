import { Namespace } from "socket.io";

let liveNamespace: Namespace | null = null;
let chatNamespace: Namespace | null = null;

export const setNamespaces = (live: Namespace, chat: Namespace) => {
  liveNamespace = live;
  chatNamespace = chat;
};

export const emitStreamStart = (
  streamId: string,
  data: {
    channelId: string;
    streamerId: string;
    title?: string;
    hlsUrl?: string;
    startedAt?: string;
  }
) => {
  liveNamespace?.to(`stream:${streamId}`).emit("stream-start", {
    streamId,
    ...data,
    timestamp: new Date().toISOString(),
  });
};

export const emitStreamEnd = (
  streamId: string,
  data?: {
    channelId?: string;
    endedAt?: string;
    duration?: number;
  }
) => {
  liveNamespace?.to(`stream:${streamId}`).emit("stream-end", {
    streamId,
    ...data,
    timestamp: new Date().toISOString(),
  });
};

export const emitViewerCount = (streamId: string, count: number) => {
  liveNamespace?.to(`stream:${streamId}`).emit("viewer-count", {
    streamId,
    count,
  });
};

export const emitChatMessage = (
  streamId: string,
  message: {
    id: string;
    userId: string;
    username: string;
    message: string;
    imageUrl?: string;
    createdAt: string;
    isHighlighted?: boolean;
    isPinned?: boolean;
  }
) => {
  chatNamespace?.to(`chat:${streamId}`).emit("new-message", message);
};

export const emitMessageDeleted = (streamId: string, messageId: string) => {
  chatNamespace?.to(`chat:${streamId}`).emit("message-deleted", {
    messageId,
    timestamp: new Date().toISOString(),
  });
};

export const emitUserMuted = (
  streamId: string,
  data: {
    userId: string;
    moderatorId: string;
    reason?: string;
    expiresAt?: string;
  }
) => {
  chatNamespace?.to(`chat:${streamId}`).emit("user-muted", {
    streamId,
    ...data,
    timestamp: new Date().toISOString(),
  });
};

export const emitUserBanned = (
  streamId: string,
  data: {
    userId: string;
    moderatorId: string;
    reason?: string;
  }
) => {
  chatNamespace?.to(`chat:${streamId}`).emit("user-banned", {
    streamId,
    ...data,
    timestamp: new Date().toISOString(),
  });
};

export const emitUserUnbanned = (streamId: string, userId: string) => {
  chatNamespace?.to(`chat:${streamId}`).emit("user-unbanned", {
    streamId,
    userId,
    timestamp: new Date().toISOString(),
  });
};
