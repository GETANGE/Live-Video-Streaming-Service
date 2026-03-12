import { Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import * as streamKeyService from "@services/streamkey.service";
import * as livestreamService from "@services/livestream.service";
import logger from "@utils/logger";
import fs from "fs";
import path from "path";

// Track active FFmpeg processes per stream key
const activeTranscoders = new Map<string, ChildProcess>();
const MAX_RESTART_ATTEMPTS = 3;
const restartCounts = new Map<string, number>();

const MEDIA_ROOT = process.env.RTMP_MEDIA_ROOT || "/tmp/media";
const FFMPEG_PATH = process.env.FFMPEG_PATH || "/usr/bin/ffmpeg";
const RTMP_INTERNAL_URL = process.env.RTMP_INTERNAL_URL || "rtmp://localhost:1935";

/**
 * Start FFmpeg to transcode RTMP → HLS segments
 */
function startHlsTranscoder(streamKey: string): void {
  if (activeTranscoders.has(streamKey)) {
    logger.warn(`[HLS Transcoder] Already running for ${streamKey}`);
    return;
  }

  const outputDir = path.join(MEDIA_ROOT, "live", streamKey);
  fs.mkdirSync(outputDir, { recursive: true });

  const inputUrl = `${RTMP_INTERNAL_URL}/live/${streamKey}`;
  const outputPath = path.join(outputDir, "index.m3u8");

  const args = [
    "-rtmp_live", "live",
    "-fflags", "+genpts+discardcorrupt",
    "-i", inputUrl,
    // Video: re-encode with x264 for consistent keyframes
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-r", "30",
    "-g", "30",
    "-keyint_min", "30",
    "-sc_threshold", "0",
    // Audio: re-encode to AAC with async resampling
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-af", "aresample=async=1",
    // HLS output — low latency
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "5",
    "-hls_flags", "delete_segments+program_date_time+independent_segments",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", path.join(outputDir, "seg_%03d.ts"),
    outputPath,
  ];

  logger.info(`[HLS Transcoder] Starting for ${streamKey}`);

  const proc = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });

  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg.includes("Error") || msg.includes("error") || msg.includes("failed")) {
      logger.error(`[HLS Transcoder] ${streamKey}: ${msg}`);
    }
  });

  proc.on("close", (code) => {
    logger.info(`[HLS Transcoder] ${streamKey} exited with code ${code}`);
    activeTranscoders.delete(streamKey);

    // Auto-restart if FFmpeg crashed unexpectedly (not stopped by us)
    if (code !== 0 && code !== null) {
      const attempts = restartCounts.get(streamKey) || 0;
      if (attempts < MAX_RESTART_ATTEMPTS) {
        restartCounts.set(streamKey, attempts + 1);
        logger.warn(`[HLS Transcoder] Restarting ${streamKey} (attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS})`);
        setTimeout(() => startHlsTranscoder(streamKey), 1000);
      } else {
        logger.error(`[HLS Transcoder] ${streamKey} exceeded max restart attempts`);
        restartCounts.delete(streamKey);
      }
    } else {
      restartCounts.delete(streamKey);
    }
  });

  proc.on("error", (err) => {
    logger.error(`[HLS Transcoder] ${streamKey} spawn error: ${err.message}`);
    activeTranscoders.delete(streamKey);
  });

  activeTranscoders.set(streamKey, proc);
}

/**
 * Stop FFmpeg transcoder for a stream key
 */
function stopHlsTranscoder(streamKey: string): void {
  const proc = activeTranscoders.get(streamKey);
  if (proc) {
    logger.info(`[HLS Transcoder] Stopping for ${streamKey}`);
    restartCounts.delete(streamKey); // Prevent auto-restart
    proc.kill("SIGTERM");
    activeTranscoders.delete(streamKey);
  }
}

/**
 * Handles NMS (Node-Media-Server) Docker container callbacks.
 *
 * NMS sends POST requests with JSON body:
 * { action, id, ip, app, name (stream key), query, protocol, ... }
 *
 * Returning non-200 causes NMS to close the session (rejects the stream).
 */
export const handleNmsCallback = async (req: Request, res: Response) => {
  const { action, app, name: streamName, id, ip } = req.body;

  logger.info(`[NMS Callback] action=${action} app=${app} name=${streamName} id=${id} ip=${ip}`);

  // Only handle "live" app streams
  if (app !== "live") {
    return res.status(200).json({ ok: true });
  }

  try {
    switch (action) {
      // postPublish fires twice in NMS (once for prePublish, once for postPublish)
      // We use postPublish to validate + start the stream
      case "postPublish": {
        if (!streamName) {
          logger.warn(`[NMS Callback] No stream key provided, rejecting session ${id}`);
          return res.status(403).json({ error: "No stream key" });
        }

        // Validate stream key
        const result = await streamKeyService.validateStreamKey(streamName);
        if (!result.valid) {
          logger.warn(`[NMS Callback] Invalid stream key: ${result.reason}, rejecting session ${id}`);
          return res.status(403).json({ error: result.reason });
        }

        logger.info(`[NMS Callback] Stream key validated for channel: ${result.streamKey?.channelName}`);

        // Start the stream (updates DB status to LIVE, sets hlsUrl, publishes event)
        try {
          await livestreamService.startStream(streamName);
          logger.info(`[NMS Callback] Stream started for key: ${streamName}`);
        } catch (err: any) {
          // If stream is already live or other error, log but don't reject
          // (NMS fires postPublish after prePublish, so we may get duplicates)
          logger.warn(`[NMS Callback] startStream note: ${err.message}`);
        }

        // Start FFmpeg HLS transcoder (RTMP → HLS segments)
        startHlsTranscoder(streamName);

        return res.status(200).json({ ok: true });
      }

      case "donePublish": {
        if (!streamName) {
          return res.status(200).json({ ok: true });
        }

        // Stop FFmpeg transcoder
        stopHlsTranscoder(streamName);

        // End the stream
        try {
          await livestreamService.endStreamByKey(streamName);
          logger.info(`[NMS Callback] Stream ended for key: ${streamName}`);
        } catch (err: any) {
          logger.warn(`[NMS Callback] endStreamByKey note: ${err.message}`);
        }

        return res.status(200).json({ ok: true });
      }

      default:
        // Allow all other actions (prePlay, postPlay, donePlay, etc.)
        return res.status(200).json({ ok: true });
    }
  } catch (error: any) {
    logger.error(`[NMS Callback] Error: ${error.message}`);
    // Return 500 — NMS will close the session on non-200
    return res.status(500).json({ error: "Internal error" });
  }
};
