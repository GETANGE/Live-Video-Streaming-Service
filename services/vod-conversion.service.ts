import { spawn } from "child_process";
import { join } from "path";
import { existsSync, readdirSync, unlinkSync, mkdirSync, writeFileSync } from "fs";
import * as livestreamRepo from "@repository/livestream.repository";
import { publishMessage } from "@events/producers/streaming.publisher";
import { minioClient, initMinio } from "@configs/minio.config";
import logger from "@utils/logger";

const TEMP_DIR = process.env.VOD_TEMP_DIR || "/tmp/vod-conversion";
const BUCKET_NAME = process.env.MINIO_BUCKET || "videos";

// Ensure temp directory exists
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

// Queue VOD conversion for a stream
export const queueVodConversion = async (streamId: string): Promise<void> => {
  const stream = await livestreamRepo.getLiveStreamById(streamId);

  if (!stream) {
    logger.error(`VOD conversion: Stream ${streamId} not found`);
    return;
  }

  if (stream.vodStatus === "processing" || stream.vodVideoId) {
    logger.warn(`VOD conversion: Stream ${streamId} already being processed`);
    return;
  }

  // Update stream status
  await livestreamRepo.updateLiveStream(streamId, {
    status: "PROCESSING_VOD",
    vodStatus: "queued",
  });

  // Publish VOD_CONVERT event to queue
  await publishMessage({
    eventType: "VOD_CONVERT",
    payload: {
      streamId,
      channelId: stream.channelId,
      streamerId: stream.streamerId,
      title: stream.title,
      duration: stream.duration,
    },
  });

  logger.info(`VOD conversion queued for stream: ${streamId}`);
};

// Process VOD conversion
export const processVodConversion = async (
  streamId: string
): Promise<void> => {
  const stream = await livestreamRepo.getLiveStreamById(streamId);

  if (!stream) {
    throw new Error(`Stream ${streamId} not found`);
  }

  logger.info(`Starting VOD conversion for stream: ${streamId}`);

  // Update status to processing
  await livestreamRepo.updateLiveStream(streamId, {
    vodStatus: "processing",
  });

  const streamDir = join(TEMP_DIR, streamId);
  const outputPath = join(streamDir, "output.mp4");

  try {
    // Create temp directory for this stream
    if (!existsSync(streamDir)) {
      mkdirSync(streamDir, { recursive: true });
    }

    // Download HLS segments from MinIO
    await downloadHlsSegments(stream.streamKey, streamDir);

    // Create concat file for FFmpeg
    const concatFile = await createConcatFile(streamDir);

    // Concatenate segments into single video
    await concatenateSegments(concatFile, outputPath);

    // Upload to MinIO
    const minioPath = `raw/${streamId}.mp4`;
    await uploadToMinio(outputPath, minioPath);

    // Publish VIDEO_PROCESS event to trigger standard processing
    await publishMessage({
      eventType: "VIDEO_PROCESS",
      payload: {
        videoId: streamId, // Use stream ID as video ID initially
        userId: stream.streamerId,
        channelId: stream.channelId,
        title: stream.title,
        description: stream.description || `VOD from livestream: ${stream.title}`,
        fileName: `${streamId}.mp4`,
        isVodConversion: true,
        sourceStreamId: streamId,
      },
    });

    // Update stream with pending VOD status
    await livestreamRepo.updateLiveStream(streamId, {
      vodStatus: "video_processing",
    });

    logger.info(`VOD conversion completed for stream: ${streamId}`);
  } catch (error: any) {
    logger.error(`VOD conversion failed for stream ${streamId}:`, error);

    await livestreamRepo.updateLiveStream(streamId, {
      vodStatus: `failed: ${error.message}`,
    });

    throw error;
  } finally {
    // Cleanup temp files
    await cleanupTempFiles(streamDir);
  }
};

// Download HLS segments from MinIO
const downloadHlsSegments = async (
  streamKey: string,
  outputDir: string
): Promise<void> => {
  await initMinio();

  const prefix = `live/${streamKey}/`;
  const stream = minioClient.listObjectsV2(BUCKET_NAME, prefix, true);

  const downloadPromises: Promise<void>[] = [];

  for await (const obj of stream) {
    if (obj.name && obj.name.endsWith(".ts")) {
      const fileName = obj.name.split("/").pop()!;
      const localPath = join(outputDir, fileName);

      // Use promise-based API
      const downloadPromise = minioClient.fGetObject(
        BUCKET_NAME,
        obj.name!,
        localPath
      );

      downloadPromises.push(downloadPromise);
    }
  }

  await Promise.all(downloadPromises);

  logger.debug(`Downloaded ${downloadPromises.length} segments to ${outputDir}`);
};

// Create FFmpeg concat file
const createConcatFile = async (dir: string): Promise<string> => {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .sort((a, b) => {
      // Sort by segment number
      const numA = parseInt(a.match(/\d+/)?.[0] || "0");
      const numB = parseInt(b.match(/\d+/)?.[0] || "0");
      return numA - numB;
    });

  if (files.length === 0) {
    throw new Error("No HLS segments found to concatenate");
  }

  const concatContent = files
    .map((f) => `file '${join(dir, f)}'`)
    .join("\n");

  const concatPath = join(dir, "concat.txt");
  writeFileSync(concatPath, concatContent);

  logger.debug(`Created concat file with ${files.length} segments`);

  return concatPath;
};

// Concatenate segments using FFmpeg
const concatenateSegments = (
  concatFile: string,
  outputPath: string
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-f", "concat",
      "-safe", "0",
      "-i", concatFile,
      "-c", "copy", // Copy without re-encoding
      "-movflags", "+faststart",
      "-y", // Overwrite output
      outputPath,
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        logger.debug(`FFmpeg concatenation completed: ${outputPath}`);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
};

// Upload file to MinIO
const uploadToMinio = async (
  localPath: string,
  minioPath: string
): Promise<void> => {
  await initMinio();

  // Use promise-based API
  await minioClient.fPutObject(BUCKET_NAME, minioPath, localPath, {
    "Content-Type": "video/mp4",
  });

  logger.debug(`Uploaded VOD to MinIO: ${minioPath}`);
};

// Cleanup temp files
const cleanupTempFiles = async (dir: string): Promise<void> => {
  try {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const file of files) {
        unlinkSync(join(dir, file));
      }
      // Remove directory
      const { rmdir } = require("fs").promises;
      await rmdir(dir);
      logger.debug(`Cleaned up temp files: ${dir}`);
    }
  } catch (error) {
    logger.warn(`Failed to cleanup temp files: ${dir}`, error);
  }
};

// Link VOD video to stream (called after video processing completes)
export const linkVodToStream = async (
  streamId: string,
  videoId: string
): Promise<void> => {
  await livestreamRepo.updateLiveStream(streamId, {
    vodVideoId: videoId,
    vodStatus: "completed",
  });

  logger.info(`VOD linked to stream: ${streamId} -> ${videoId}`);
};

// Get VOD conversion status
export const getVodConversionStatus = async (
  streamId: string
): Promise<{
  status: string | null;
  vodVideoId: string | null;
}> => {
  const stream = await livestreamRepo.getLiveStreamById(streamId);

  if (!stream) {
    throw new Error("Stream not found");
  }

  return {
    status: stream.vodStatus,
    vodVideoId: stream.vodVideoId,
  };
};

// Retry failed VOD conversion
export const retryVodConversion = async (streamId: string): Promise<void> => {
  const stream = await livestreamRepo.getLiveStreamById(streamId);

  if (!stream) {
    throw new Error("Stream not found");
  }

  if (stream.vodVideoId) {
    throw new Error("VOD already exists for this stream");
  }

  // Reset status and requeue
  await livestreamRepo.updateLiveStream(streamId, {
    vodStatus: undefined,
  });

  await queueVodConversion(streamId);
};
