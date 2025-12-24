import ffmpeg from "fluent-ffmpeg";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import logger from "@utils/logger";

export const TEMP_DIR = process.env.FFMPEG_TEMP_DIR || "/tmp/video-processing";


// Ensure temp directory exists
export const ensureTempDir = async (videoId: string): Promise<string> => {
  const dir = join(TEMP_DIR, videoId);
  await mkdir(dir, { recursive: true });
  return dir;
};

// Clean up temp directory
export const cleanupTempDir = async (videoId: string): Promise<void> => {
  const dir = join(TEMP_DIR, videoId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.warn(`Failed to cleanup temp dir ${dir}:`, error);
  }
};

// Get video metadata
export const getVideoMetadata = (
  inputPath: string,
): Promise<{ duration: number }> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) reject(err);
      else resolve({ duration: metadata.format.duration || 0 });
    });
  });
};

// Generate thumbnail from video
export const generateThumbnail = (
  inputPath: string,
  outputPath: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        count: 1,
        folder: outputPath.substring(0, outputPath.lastIndexOf("/")),
        filename: outputPath.split("/").pop(),
        size: "640x360",
      })
      .on("end", () => resolve())
      .on("error", reject);
  });
};
