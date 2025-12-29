import { spawn, ChildProcess } from "child_process";
import { Socket } from "socket.io";
import * as streamKeyService from "@services/streamkey.service";
import {
  setActiveStream,
  getActiveStream,
  removeActiveStream,
  isStreamActive,
  getActiveStreamCount as getRedisStreamCount,
  getAllActiveStreams as getRedisAllActiveStreams,
  updateStreamBytes,
} from "@helpers/cacheInvalidations/browserStreamCacheInvalidation";
import logger from "@utils/logger";
import { v4 as uuidv4 } from "uuid";

interface LocalStreamRef {
  ffmpeg: ChildProcess;
  socket: Socket;
  bytesReceived: number;
}

const localStreams = new Map<string, LocalStreamRef>();
const RTMP_URL = process.env.RTMP_INTERNAL_URL || "rtmp://localhost:1935";
const SERVER_ID = process.env.SERVER_ID || uuidv4();
const STREAM_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours max

export const handleBrowserStream = async (
  socket: Socket,
  streamKey: string
): Promise<void> => {
  logger.info(`Browser stream connection: ${streamKey.substring(0, 10)}...`);

  const validation = await streamKeyService.validateStreamKey(streamKey);

  if (!validation.valid) {
    logger.warn(`Invalid stream key: ${validation.reason}`);
    socket.emit("error", { code: 4001, message: validation.reason });
    socket.disconnect();
    return;
  }

  const alreadyActive = await isStreamActive(streamKey);
  if (alreadyActive) {
    logger.warn(`Stream already active: ${streamKey.substring(0, 10)}...`);
    socket.emit("error", { code: 4002, message: "Stream already active" });
    socket.disconnect();
    return;
  }

  const ffmpegArgs = [
    "-f", "webm",
    "-i", "pipe:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-level", "3.1",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-g", "60",
    "-b:v", "2500k",
    "-maxrate", "2500k",
    "-bufsize", "5000k",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-f", "flv",
    `${RTMP_URL}/live/${streamKey}`,
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const localRef: LocalStreamRef = {
    ffmpeg,
    socket,
    bytesReceived: 0,
  };

  localStreams.set(streamKey, localRef);

  await setActiveStream(streamKey, {
    streamKey,
    startedAt: new Date().toISOString(),
    bytesReceived: 0,
    channelName: validation.streamKey?.channelName,
    serverId: SERVER_ID,
  });

  logger.info(`Browser stream started: ${streamKey.substring(0, 10)}...`);

  ffmpeg.stderr?.on("data", (data: Buffer) => {
    const output = data.toString();
    if (output.includes("Error") || output.includes("error")) {
      logger.warn(`FFmpeg: ${output}`);
    }
  });

  ffmpeg.on("close", (code) => {
    logger.info(`FFmpeg closed with code ${code}`);
    cleanup(streamKey);
  });

  ffmpeg.on("error", (err) => {
    logger.error(`FFmpeg error: ${err.message}`);
    socket.emit("error", { code: 4003, message: "Streaming error" });
    cleanup(streamKey);
  });

  socket.on("stream-data", async (data: Buffer) => {
    if (!ffmpeg.stdin?.writable) {
      return;
    }
    try {
      ffmpeg.stdin.write(data);
      localRef.bytesReceived += data.length;

      if (localRef.bytesReceived % (1024 * 1024) < data.length) {
        await updateStreamBytes(streamKey, localRef.bytesReceived);
      }
    } catch (err) {
      logger.error(`Error writing to FFmpeg: ${err}`);
    }
  });

  socket.on("stop-stream", () => {
    logger.info(`Stream stop requested: ${streamKey.substring(0, 10)}...`);
    cleanup(streamKey);
  });

  socket.on("disconnect", () => {
    logger.info(`Browser stream disconnected: ${streamKey.substring(0, 10)}...`);
    cleanup(streamKey);
  });

  socket.emit("stream-ready", {
    message: "Stream connection established",
    channelName: validation.streamKey?.channelName,
  });
};

const cleanup = async (streamKey: string) => {
  const localRef = localStreams.get(streamKey);
  if (!localRef) return;

  try {
    const streamData = await getActiveStream(streamKey);
    const startedAt = streamData ? new Date(streamData.startedAt) : new Date();
    const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000);

    logger.info(
      `Cleanup browser stream: ${streamKey.substring(0, 10)}... ` +
        `(duration: ${duration}s, received: ${formatBytes(localRef.bytesReceived)})`
    );

    localRef.ffmpeg.stdin?.end();
    if (!localRef.ffmpeg.killed) {
      localRef.ffmpeg.kill("SIGTERM");
    }
    if (localRef.socket.connected) {
      localRef.socket.emit("stream-ended", { duration });
      localRef.socket.disconnect();
    }
  } catch (err) {
    logger.error(`Error during cleanup: ${err}`);
  } finally {
    localStreams.delete(streamKey);
    await removeActiveStream(streamKey).catch((err) =>
      logger.error(`Failed to remove from Redis: ${err}`)
    );
  }
};

const cleanupStaleStreams = async () => {
  const now = Date.now();

  for (const [streamKey] of localStreams.entries()) {
    const streamData = await getActiveStream(streamKey);
    if (!streamData) {
      logger.warn(`Orphaned local stream found: ${streamKey.substring(0, 10)}...`);
      await cleanup(streamKey);
      continue;
    }

    const startedAt = new Date(streamData.startedAt).getTime();
    if (now - startedAt > STREAM_TIMEOUT_MS) {
      logger.warn(`Stream timeout: ${streamKey.substring(0, 10)}...`);
      await cleanup(streamKey);
    }
  }
};

export const startCleanupJob = () => {
  cleanupStaleStreams();
  setInterval(cleanupStaleStreams, 60 * 1000);
  logger.info("Browser stream cleanup job started");
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const getActiveStreamCount = async (): Promise<number> => {
  return getRedisStreamCount();
};

export const getStreamStats = async (streamKey: string) => {
  const streamData = await getActiveStream(streamKey);
  if (!streamData) return { active: false };

  const startedAt = new Date(streamData.startedAt);
  return {
    active: true,
    duration: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    bytesReceived: streamData.bytesReceived,
    serverId: streamData.serverId,
  };
};

export const stopBrowserStream = async (streamKey: string): Promise<boolean> => {
  if (!localStreams.has(streamKey)) return false;
  await cleanup(streamKey);
  return true;
};

export const stopAllBrowserStreams = async (): Promise<void> => {
  logger.info(`Stopping all browser streams (${localStreams.size} active)`);
  for (const streamKey of localStreams.keys()) {
    await cleanup(streamKey);
  }
};

export const getAllActiveStreams = async () => {
  const streams = await getRedisAllActiveStreams();
  return streams.map((stream) => ({
    streamKey: stream.streamKey.substring(0, 10) + "...",
    duration: Math.floor(
      (Date.now() - new Date(stream.startedAt).getTime()) / 1000
    ),
    bytesReceived: stream.bytesReceived,
    serverId: stream.serverId,
  }));
};

export const cleanupOrphanedRedisEntries = async (): Promise<number> => {
  const streams = await getRedisAllActiveStreams();
  let cleaned = 0;

  for (const stream of streams) {
    if (stream.serverId === SERVER_ID && !localStreams.has(stream.streamKey)) {
      logger.warn(`Orphaned Redis entry: ${stream.streamKey.substring(0, 10)}...`);
      await removeActiveStream(stream.streamKey);
      cleaned++;
    }
  }

  return cleaned;
};

export const getLocalStreamCount = (): number => localStreams.size;
