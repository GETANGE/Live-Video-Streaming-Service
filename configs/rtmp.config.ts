import NodeMediaServer from "node-media-server";
import redisClient from "@configs/redis.config";
import { RtmpSessionData, NmsSession } from "@types";
import * as streamKeyService from "@services/streamkey.service";
import * as livestreamService from "@services/livestream.service";
import logger from "@utils/logger";


const RTMP_PORT = parseInt(process.env.RTMP_PORT || "1935");
const RTMP_HOST = process.env.RTMP_HOST || "0.0.0.0";

const HTTP_PORT = parseInt(process.env.RTMP_HTTP_PORT || "8000");
const HTTP_HOST = process.env.RTMP_HTTP_HOST || "0.0.0.0";

const MEDIA_ROOT = process.env.RTMP_MEDIA_ROOT || "/tmp/media";
const FFMPEG_PATH = process.env.FFMPEG_PATH || "/usr/bin/ffmpeg";

const config = {
  rtmp: {
    port: RTMP_PORT,
    host: RTMP_HOST,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: HTTP_PORT,
    host: HTTP_HOST,
    allow_origin: "*",
    mediaroot: MEDIA_ROOT,
  },
  trans: {
    ffmpeg: FFMPEG_PATH,
    tasks: [
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=2:hls_list_size=6:hls_flags=delete_segments]",
        hlsKeep: false,
        dash: false,
      },
    ],
  },
  auth: {
    api: false,
    api_user: "",
    api_pass: "",
  },
  logType: 0,
};

let nms: NodeMediaServer | null = null;

// get session data 
export const getSessionData = async (sessionId: string): Promise<RtmpSessionData | null> => {
  const data = await redisClient.hgetall(`rtmp:session:${sessionId}`);
  if (!data || !data.streamKey) return null;
  return data as unknown as RtmpSessionData;
};

// set session data
export const setSessionData = async (sessionId: string, data: Partial<RtmpSessionData>): Promise<void> => {
  await redisClient.hset(`rtmp:session:${sessionId}`, data as Record<string, string>);
  await redisClient.expire(`rtmp:session:${sessionId}`, 86400);
};

// delete session data
export const deleteSessionData = async (sessionId: string): Promise<void> => {
  const data = await getSessionData(sessionId);
  if (data?.streamKey) {
    await redisClient.del(`rtmp:stream:${data.streamKey}`);
  }
  await redisClient.del(`rtmp:session:${sessionId}`);
};

// initialize RTMP server
export const initRtmpServer = (): void => {
  nms = new NodeMediaServer(config);

  nms.on("preConnect", (id: string, _StreamPath: string, _args: object) => {
    logger.debug(`[RTMP] PreConnect id=${id}`);
  });

  nms.on("postConnect", (id: string, _StreamPath: string, _args: object) => {
    logger.debug(`[RTMP] PostConnect id=${id}`);
  });

  nms.on("doneConnect", (id: string, _StreamPath: string, _args: object) => {
    logger.debug(`[RTMP] DoneConnect id=${id}`);
  });

  nms.on("prePublish", async (id: string, StreamPath: string, _args: object) => {
    logger.info(`[RTMP] PrePublish id=${id} StreamPath=${StreamPath}`);

    const pathParts = StreamPath.split("/");
    const streamKey = pathParts[pathParts.length - 1];

    if (!streamKey) {
      logger.warn(`[RTMP] No stream key provided, rejecting session ${id}`);
      const session = nms!.getSession(id) as unknown as NmsSession | undefined;
      session?.reject();
      return;
    }

    try {
      const result = await streamKeyService.validateStreamKey(streamKey);

      if (!result.valid) {
        logger.warn(`[RTMP] Invalid stream key: ${result.reason}, rejecting session ${id}`);
        const session = nms!.getSession(id) as unknown as NmsSession | undefined;
        session?.reject();
        return;
      }

      logger.info(`[RTMP] Stream key validated for channel: ${result.streamKey?.channelName}`);

      await setSessionData(id, {
        streamKey,
        channelId: result.streamKey!.channelId,
        userId: result.streamKey!.userId,
        channelName: result.streamKey!.channelName,
        streamPath: StreamPath,
        status: "connecting",
        startedAt: Date.now().toString(),
      });
    } catch (error: any) {
      logger.error(`[RTMP] Validation failed: ${error.message}`);
      const session = nms!.getSession(id) as unknown as NmsSession | undefined;
      session?.reject();
    }
  });

  nms.on("postPublish", async (id: string, StreamPath: string, _args: object) => {
    logger.info(`[RTMP] PostPublish id=${id} StreamPath=${StreamPath}`);

    try {
      const sessionData = await getSessionData(id);

      if (!sessionData) {
        logger.error(`[RTMP] No session data found for ${id}`);
        return;
      }

      await setSessionData(id, { status: "live" });
      await redisClient.set(`rtmp:stream:${sessionData.streamKey}`, id);
      await redisClient.expire(`rtmp:stream:${sessionData.streamKey}`, 86400);

      await livestreamService.startStream(sessionData.streamKey);

      logger.info(`[RTMP] Stream started: ${sessionData.channelName}`);
    } catch (error: any) {
      logger.error(`[RTMP] PostPublish error: ${error.message}`);
    }
  });

  nms.on("donePublish", async (id: string, StreamPath: string, _args: object) => {
    logger.info(`[RTMP] DonePublish id=${id} StreamPath=${StreamPath}`);

    try {
      const sessionData = await getSessionData(id);

      if (!sessionData) {
        logger.error(`[RTMP] No session data found for ${id}`);
        return;
      }

      await livestreamService.endStreamByKey(sessionData.streamKey);
      await deleteSessionData(id);

      logger.info(`[RTMP] Stream ended: ${sessionData.channelName}`);
    } catch (error: any) {
      logger.error(`[RTMP] DonePublish error: ${error.message}`);
    }
  });

  nms.on("prePlay", (id: string, StreamPath: string, _args: object) => {
    logger.debug(`[RTMP] PrePlay id=${id} StreamPath=${StreamPath}`);
  });

  nms.on("postPlay", (id: string, StreamPath: string, _args: object) => {
    logger.debug(`[RTMP] PostPlay id=${id} StreamPath=${StreamPath}`);
  });

  nms.on("donePlay", (id: string, StreamPath: string, _args: object) => {
    logger.debug(`[RTMP] DonePlay id=${id}`);
  });

  logger.info(`RTMP server started on port ${RTMP_PORT}`);
  logger.info(`RTMP HTTP/HLS server started on port ${HTTP_PORT}`);
  logger.info(`Stream URL: rtmp://localhost:${RTMP_PORT}/live/{stream_key}`);
  logger.info(`HLS URL: http://localhost:${HTTP_PORT}/live/{stream_key}/index.m3u8`);
};

export const stopRtmpServer = async (): Promise<void> => {
  if (!nms) return;

  logger.info("[RTMP] Shutting down...");

  const keys = await redisClient.keys("rtmp:session:*");
  for (const key of keys) {
    const sessionId = key.replace("rtmp:session:", "");
    await deleteSessionData(sessionId);
  }

  nms.stop();
  nms = null;

  logger.info("[RTMP] Shutdown complete");
};

export const getRtmpStats = (): { running: boolean; ports: { rtmp: number; http: number } } => {
  return {
    running: nms !== null,
    ports: {
      rtmp: RTMP_PORT,
      http: HTTP_PORT,
    },
  };
};

export const isStreamLive = async (streamKey: string): Promise<boolean> => {
  const sessionId = await redisClient.get(`rtmp:stream:${streamKey}`);
  if (!sessionId) return false;

  const sessionData = await getSessionData(sessionId);
  return sessionData?.status === "live";
};

export const getActiveStreamCount = async (): Promise<number> => {
  const keys = await redisClient.keys("rtmp:session:*");
  let count = 0;

  for (const key of keys) {
    const sessionId = key.replace("rtmp:session:", "");
    const data = await getSessionData(sessionId);
    if (data?.status === "live") count++;
  }

  return count;
};
