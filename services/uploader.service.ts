import {
  uploadToMinio,
  deleteFromMinio,
  deleteByPrefix,
  streamFromMinio,
  uploadHLSFile,
  uploadThumbnail as uploadThumbnailToMinio,
  getPublicUrl,
} from "@helpers/hls.helper-functions";
import { processVideoToHLS } from "@services/chunker.service";
import { ProgressCallback } from "@utils/workerPool";
import {
  syncThumbnailToCDN,
  syncVideoToCDN,
  deleteFromCDN,
  clearCDNCache,
  getContentUrl,
} from "@services/cdn.service";
import crypto from "crypto";
import logger from "@utils/logger";
import { UploadResult } from "@types";

// Upload profile picture → MinIO
export const uploadProfilePic = async (
  buffer: Buffer,
  userId: string,
): Promise<{ url: string }> => {
  logger.info(`Uploading profile pic for user ${userId}`);

  const path = `profiles/${userId}.jpg`;
  await uploadToMinio(path, buffer, "image/jpeg");
  const url = getPublicUrl(path);

  return { url };
};

// Upload video thumbnail → MinIO
export const uploadThumbnail = async (
  buffer: Buffer,
  videoId: string,
): Promise<{ url: string }> => {
  logger.info(`Uploading thumbnail for video ${videoId}`);

  const path = await uploadThumbnailToMinio(videoId, buffer);
  const url = getPublicUrl(path);

  return { url };
};

// Upload raw video → MinIO only (queued for processing)
export const uploadRawVideo = async (
  buffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<{ id: string; originalUrl: string }> => {
  const id = crypto.randomUUID();
  const extension = fileName.split(".").pop() || "mp4";
  const minioFileName = `raw/${id}.${extension}`;

  logger.info(`Uploading raw video ${id} to MinIO`);

  await uploadToMinio(minioFileName, buffer, contentType);
  const originalUrl = getPublicUrl(minioFileName);

  return { id, originalUrl };
};

// Process video: FFmpeg transcode + upload HLS to MinIO + sync thumbnail to CDN
export const processVideo = async (
  videoId: string,
  buffer: Buffer,
  onProgress?: ProgressCallback,
): Promise<UploadResult> => {
  logger.info(`Processing video ${videoId} with FFmpeg`);

  // Transcode to HLS
  const { masterPlaylist, variants, thumbnailBuffer, duration } = await processVideoToHLS(buffer, videoId, onProgress);

  // Upload master playlist
  const masterPath = `hls/${videoId}/master.m3u8`;
  await uploadHLSFile(masterPath, masterPlaylist, true);

  // Upload each variant's playlist and segments
  for (const variant of variants) {
    const playlistPath = `hls/${videoId}/${variant.quality}/playlist.m3u8`;
    await uploadHLSFile(playlistPath, variant.playlist, true);

    for (const segment of variant.segments) {
      const segmentPath = `hls/${videoId}/${variant.quality}/${segment.name}`;
      await uploadHLSFile(segmentPath, segment.data, false);
    }
  }

  // Upload thumbnail to MinIO
  await uploadThumbnailToMinio(videoId, thumbnailBuffer);

  // Eager sync: Push thumbnail to CDN (non-blocking, best-effort)
  syncThumbnailToCDN(videoId, thumbnailBuffer).catch((err) =>
    logger.warn(`CDN thumbnail sync failed for ${videoId}:`, err),
  );

  logger.info(`Video ${videoId} processed and uploaded`);

  // Return URLs (CDN if available, MinIO fallback)
  const [thumbnailUrl, streamingUrl] = await Promise.all([
    getContentUrl("thumbnail", videoId),
    getContentUrl("stream", videoId),
  ]);

  return {
    id: videoId,
    originalUrl: getPublicUrl(`raw/${videoId}.mp4`),
    thumbnailUrl: thumbnailUrl.url,
    streamingUrl: streamingUrl.url,
    duration: Math.round(duration),
  };
};

// Process video from MinIO storage (for queue worker)
export const processVideoFromStorage = async (
  videoId: string,
  minioFileName: string,
  onProgress?: ProgressCallback,
): Promise<UploadResult> => {
  logger.info(`Fetching video ${videoId} from MinIO for processing`);

  // Stream from MinIO
  const stream = await streamFromMinio(minioFileName);

  // Collect stream into buffer
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  // Process the video
  return processVideo(videoId, buffer, onProgress);
};

// Delete video and all HLS files from MinIO + CDN
export const deleteVideo = async (videoId: string): Promise<void> => {
  logger.info(`Deleting video ${videoId}`);

  // Delete raw file from MinIO
  try {
    await deleteFromMinio(`raw/${videoId}.mp4`);
  } catch (e) {
    logger.warn(`Raw file not found for ${videoId}`);
  }

  // Delete thumbnail from MinIO
  try {
    await deleteFromMinio(`thumbnails/${videoId}.jpg`);
  } catch (e) {
    logger.warn(`Thumbnail not found for ${videoId}`);
  }

  // Delete all HLS segments and playlists from MinIO
  try {
    const deletedCount = await deleteByPrefix(`hls/${videoId}/`);
    logger.info(`Deleted ${deletedCount} HLS files for video ${videoId}`);
  } catch (e) {
    logger.warn(`Failed to delete HLS files for ${videoId}:`, e);
  }

  // Delete from CDN (best-effort)
  await deleteFromCDN(`thumbnails/${videoId}`, "image");
  await deleteFromCDN(`videos/${videoId}`, "video");

  // Clear CDN cache entries
  await Promise.all([
    clearCDNCache("thumbnail", videoId),
    clearCDNCache("video", videoId),
    clearCDNCache("stream", videoId),
  ]);
};

// Delete profile picture
export const deleteProfilePic = async (userId: string): Promise<void> => {
  await deleteFromMinio(`profiles/${userId}.jpg`);
};

// Lazy sync: Push video to CDN on-demand (for popular/requested videos)
export const pushVideoToCDN = async (
  videoId: string,
): Promise<{ cdnUrl: string } | null> => {
  logger.info(`Pushing video ${videoId} to CDN (lazy sync)`);

  const result = await syncVideoToCDN(videoId, `raw/${videoId}.mp4`);

  if (result) {
    return { cdnUrl: result.cdnUrl };
  }

  return null;
};

// Get video URLs with CDN preference
export const getVideoUrls = async (
  videoId: string,
): Promise<{
  thumbnail: { url: string; source: "cdn" | "minio" };
  stream: { url: string; source: "cdn" | "minio" };
  raw: { url: string; source: "minio" };
}> => {
  const [thumbnail, stream] = await Promise.all([
    getContentUrl("thumbnail", videoId),
    getContentUrl("stream", videoId),
  ]);

  return {
    thumbnail,
    stream,
    raw: { url: getPublicUrl(`raw/${videoId}.mp4`), source: "minio" },
  };
};
