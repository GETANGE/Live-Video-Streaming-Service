import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import logger from "@utils/logger";
import {
  generateThumbnail,
  getVideoMetadata,
  ensureTempDir,
  cleanupTempDir,
  TEMP_DIR,
} from "@services/ffmpeg.service";
import { transcodeVariant } from "@services/video-encoder.service";

// HLS settings
const HLS_SEGMENT_DURATION = 6;

// Quality presets
const QUALITY_PRESETS = [
  { name: "360p", width: 640, height: 360, bitrate: "800k", audioBitrate: "96k" },
  { name: "720p", width: 1280, height: 720, bitrate: "2500k", audioBitrate: "128k" },
  { name: "1080p", width: 1920, height: 1080, bitrate: "5000k", audioBitrate: "192k" },
  { name: "2160p", width: 3840, height: 2160, bitrate: "10000k", audioBitrate: "256k" },
];

interface HLSOutput {
  masterPlaylist: string;
  variants: { quality: string; playlist: string; segments: string[] }[];
}

// Transcode video to HLS with multiple quality variants
export const transcodeToHLS = async (
  inputPath: string,
  videoId: string,
): Promise<HLSOutput> => {
  const workDir = join(TEMP_DIR, videoId);
  const variants: HLSOutput["variants"] = [];

  logger.info(`Starting HLS transcode for ${videoId}`);

  for (const preset of QUALITY_PRESETS) {
    const variantDir = join(workDir, preset.name);
    await mkdir(variantDir, { recursive: true });

    logger.info(`Transcoding ${videoId} to ${preset.name}`);
    await transcodeVariant(inputPath, variantDir, preset, HLS_SEGMENT_DURATION);

    const files = await readdir(variantDir);
    const segments = files.filter((f) => f.endsWith(".ts"));

    variants.push({
      quality: preset.name,
      playlist: join(variantDir, "playlist.m3u8"),
      segments: segments.map((s) => join(variantDir, s)),
    });

    logger.info(`Completed ${preset.name} for ${videoId}`);
  }

  // Generate master playlist
  const masterPlaylistPath = join(workDir, "master.m3u8");
  const masterContent = generateMasterPlaylist(variants);
  await writeFile(masterPlaylistPath, masterContent);

  logger.info(`HLS transcode complete for ${videoId}`);

  return { masterPlaylist: masterPlaylistPath, variants };
};

// Generate HLS master playlist content
const generateMasterPlaylist = (
  variants: HLSOutput["variants"],
): string => {
  let content = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

  for (const variant of variants) {
    const preset = QUALITY_PRESETS.find((p) => p.name === variant.quality)!;
    const bandwidth = parseInt(preset.bitrate) * 1000;
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${preset.width}x${preset.height}\n`;
    content += `${variant.quality}/playlist.m3u8\n`;
  }

  return content;
};

// Main processing function - orchestrates chunking pipeline
export const processVideoToHLS = async (
  inputBuffer: Buffer,
  videoId: string,
): Promise<{
  masterPlaylist: Buffer;
  variants: {
    quality: string;
    playlist: Buffer;
    segments: { name: string; data: Buffer }[];
  }[];
  thumbnailBuffer: Buffer;
  duration: number;
}> => {
  const workDir = await ensureTempDir(videoId);
  const inputPath = join(workDir, `input.mp4`);
  const thumbnailPath = join(workDir, "thumbnail.jpg");

  try {
    await writeFile(inputPath, inputBuffer);

    const { duration } = await getVideoMetadata(inputPath);

    await generateThumbnail(inputPath, thumbnailPath);
    const thumbnailBuffer = await readFile(thumbnailPath);

    const hlsOutput = await transcodeToHLS(inputPath, videoId);

    const masterPlaylist = await readFile(hlsOutput.masterPlaylist);

    const variants = await Promise.all(
      hlsOutput.variants.map(async (v) => ({
        quality: v.quality,
        playlist: await readFile(v.playlist),
        segments: await Promise.all(
          v.segments.map(async (segPath) => ({
            name: segPath.split("/").pop()!,
            data: await readFile(segPath),
          })),
        ),
      })),
    );

    return { masterPlaylist, variants, thumbnailBuffer, duration };
  } finally {
    await cleanupTempDir(videoId);
  }
};

export { QUALITY_PRESETS, HLS_SEGMENT_DURATION };
