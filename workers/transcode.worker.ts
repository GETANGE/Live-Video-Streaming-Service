import { parentPort, workerData } from "worker_threads";
import ffmpeg from "fluent-ffmpeg";
import { join } from "path";

interface TranscodeTask {
  inputPath: string;
  outputDir: string;
  preset: {
    name: string;
    width: number;
    height: number;
    bitrate: string;
    audioBitrate: string;
  };
  segmentDuration: number;
}

const HLS_PLAYLIST_TYPE = "vod";

const transcode = (task: TranscodeTask): Promise<void> => {
  return new Promise((resolve, reject) => {
    const { inputPath, outputDir, preset, segmentDuration } = task;
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
      .on("progress", (progress) => {
        parentPort?.postMessage({
          type: "progress",
          quality: preset.name,
          percent: progress.percent || 0,
        });
      })
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
};

// Run transcoding when worker starts
const task = workerData as TranscodeTask;

transcode(task)
  .then(() => {
    parentPort?.postMessage({ type: "done", quality: task.preset.name });
  })
  .catch((error) => {
    parentPort?.postMessage({
      type: "error",
      quality: task.preset.name,
      error: error.message,
    });
  });
