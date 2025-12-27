import { minioClient } from "@configs/minio.config";
import { createCircuitBreaker, getCircuitStats } from "@utils/circuitBreaker";

const BUCKET_NAME = process.env.MINIO_BUCKET || "videos";

// Raw MinIO operations (wrapped by circuit breakers)
const _uploadToMinio = async (
  fileName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> => {
  await minioClient.putObject(BUCKET_NAME, fileName, buffer, buffer.length, {
    "Content-Type": contentType,
  });

  return `${BUCKET_NAME}/${fileName}`;
};

const _deleteFromMinio = async (fileName: string): Promise<void> => {
  await minioClient.removeObject(BUCKET_NAME, fileName);
};

const _streamFromMinio = async (fileName: string) => {
  return minioClient.getObject(BUCKET_NAME, fileName);
};

const _uploadHLSFile = async (
  path: string,
  buffer: Buffer,
  isPlaylist: boolean,
): Promise<string> => {
  const contentType = isPlaylist ? "application/vnd.apple.mpegurl" : "video/MP2T";

  await minioClient.putObject(BUCKET_NAME, path, buffer, buffer.length, {
    "Content-Type": contentType,
    "Cache-Control": isPlaylist ? "no-cache" : "max-age=31536000",
  });

  return path;
};

const _uploadThumbnail = async (
  videoId: string,
  buffer: Buffer,
): Promise<string> => {
  const path = `thumbnails/${videoId}.jpg`;

  await minioClient.putObject(BUCKET_NAME, path, buffer, buffer.length, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "max-age=86400",
  });

  return path;
};

// Circuit breakers for MinIO operations
const uploadBreaker = createCircuitBreaker(_uploadToMinio, {
  name: "MinIO:Upload",
  timeout: 30000, // 30s for uploads
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

const deleteBreaker = createCircuitBreaker(_deleteFromMinio, {
  name: "MinIO:Delete",
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

const streamBreaker = createCircuitBreaker(_streamFromMinio, {
  name: "MinIO:Stream",
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

const hlsUploadBreaker = createCircuitBreaker(_uploadHLSFile, {
  name: "MinIO:HLSUpload",
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

const thumbnailUploadBreaker = createCircuitBreaker(_uploadThumbnail, {
  name: "MinIO:ThumbnailUpload",
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

// Public MinIO functions (use circuit breakers)
export const uploadToMinio = async (
  fileName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> => {
  return uploadBreaker.fire(fileName, buffer, contentType);
};

export const deleteFromMinio = async (fileName: string): Promise<void> => {
  return deleteBreaker.fire(fileName);
};

export const streamFromMinio = async (fileName: string) => {
  return streamBreaker.fire(fileName);
};

export const uploadHLSFile = async (
  path: string,
  buffer: Buffer,
  isPlaylist: boolean,
): Promise<string> => {
  return hlsUploadBreaker.fire(path, buffer, isPlaylist);
};

export const uploadThumbnail = async (
  videoId: string,
  buffer: Buffer,
): Promise<string> => {
  return thumbnailUploadBreaker.fire(videoId, buffer);
};

// Delete all objects with a given prefix (for HLS cleanup)
// Note: Not wrapped in circuit breaker as it's a batch operation with internal retry logic
export const deleteByPrefix = async (prefix: string): Promise<number> => {
  const objectsList: string[] = [];
  const stream = minioClient.listObjects(BUCKET_NAME, prefix, true);

  return new Promise((resolve, reject) => {
    stream.on("data", (obj) => {
      if (obj.name) {
        objectsList.push(obj.name);
      }
    });

    stream.on("error", reject);

    stream.on("end", async () => {
      if (objectsList.length === 0) {
        resolve(0);
        return;
      }

      await minioClient.removeObjects(BUCKET_NAME, objectsList);
      resolve(objectsList.length);
    });
  });
};

// URL helper functions (no circuit breaker needed - no external calls)
export const getMinioUrl = (fileName: string): string => {
  const endpoint = process.env.MINIO_ENDPOINT || "localhost";
  const port = process.env.MINIO_PORT || "9000";
  const protocol = process.env.MINIO_USE_SSL === "true" ? "https" : "http";

  return `${protocol}://${endpoint}:${port}/${BUCKET_NAME}/${fileName}`;
};

export const getPresignedUrl = async (
  fileName: string,
  expirySeconds: number = 3600,
): Promise<string> => {
  return minioClient.presignedGetObject(BUCKET_NAME, fileName, expirySeconds);
};

export const getPublicUrl = (path: string): string => {
  // Use public endpoint for browser-accessible URLs (falls back to internal endpoint)
  const endpoint = process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT || "localhost";
  const port = process.env.MINIO_PUBLIC_PORT || process.env.MINIO_PORT || "9000";
  const protocol = process.env.MINIO_USE_SSL === "true" ? "https" : "http";

  return `${protocol}://${endpoint}:${port}/${BUCKET_NAME}/${path}`;
};

// Get circuit breaker stats for monitoring
export const getMinioCircuitStats = () => ({
  upload: getCircuitStats(uploadBreaker),
  delete: getCircuitStats(deleteBreaker),
  stream: getCircuitStats(streamBreaker),
  hlsUpload: getCircuitStats(hlsUploadBreaker),
  thumbnailUpload: getCircuitStats(thumbnailUploadBreaker),
});
