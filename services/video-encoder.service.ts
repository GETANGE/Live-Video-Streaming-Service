import ffmpeg from "fluent-ffmpeg";
import { join } from "path";
import { QualityPreset } from "@types";

const HLS_PLAYLIST_TYPE = "vod";

// Transcode to single quality HLS variant
export const transcodeVariant = (
  inputPath: string,
  outputDir: string,
  preset: QualityPreset,
  segmentDuration: number,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const playlistPath = join(outputDir, "playlist.m3u8");

    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`,
        "-c:v libx264",
        "-preset fast",
        "-crf 22",
        `-b:v ${preset.bitrate}`,
        `-maxrate ${preset.bitrate}`,
        `-bufsize ${parseInt(preset.bitrate) * 2}k`,
        "-c:a aac",
        `-b:a ${preset.audioBitrate}`,
        `-hls_time ${segmentDuration}`,
        `-hls_playlist_type ${HLS_PLAYLIST_TYPE}`,
        `-hls_segment_filename ${join(outputDir, "segment_%03d.ts")}`,
      ])
      .output(playlistPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
};
