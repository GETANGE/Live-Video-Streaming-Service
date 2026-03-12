import { parentPort, workerData } from "worker_threads";
import { LiveTranscodeTask, QualityPreset } from "@types";
import ffmpeg from "fluent-ffmpeg";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";

const LL_HLS_SETTINGS = {
  segmentDuration: 1,
  partDuration: 0.2,
  playlistSize: 10,
  deleteThreshold: 6,
};

const DEFAULT_QUALITIES: QualityPreset[] = [
  { name: "360p", width: 640, height: 360, bitrate: "800k", audioBitrate: "96k" },
  { name: "720p", width: 1280, height: 720, bitrate: "3000k", audioBitrate: "128k" },
  { name: "1080p", width: 1920, height: 1080, bitrate: "6000k", audioBitrate: "192k" },
  { name: "2160", width: 3840, height: 2160, bitrate: "18000k", audioBitrate: "384k" },
];

const detectHardwareAcceleration = (): "nvenc" | "vaapi" | "cpu" => {
  const hwaccel = process.env.FFMPEG_HWACCEL;
  if (hwaccel) return hwaccel as any;

  try {
    execSync("nvidia-smi", { stdio: "ignore" });
    return "nvenc";
  } catch {
    try {
      if (existsSync("/dev/dri/renderD128")) {
        return "vaapi";
      }
    } catch {}
  }
  return "cpu";
};

const HWACCEL = detectHardwareAcceleration();

const getEncoderOptions = (preset: QualityPreset): string[] => {
  const bitrateNum = parseInt(preset.bitrate);

  switch (HWACCEL) {
    case "nvenc":
      return [
        "-c:v h264_nvenc",
        "-preset p1",
        "-tune ll",
        "-zerolatency 1",
        "-rc vbr",
        `-b:v ${preset.bitrate}`,
        `-maxrate ${bitrateNum * 1.2}k`,
        `-bufsize ${preset.bitrate}`,
      ];

    case "vaapi":
      return [
        "-vaapi_device /dev/dri/renderD128",
        "-c:v h264_vaapi",
        `-b:v ${preset.bitrate}`,
        `-maxrate ${bitrateNum * 1.2}k`,
        `-bufsize ${preset.bitrate}`,
      ];

    default:
      return [
        "-c:v libx264",
        "-preset ultrafast",
        "-tune zerolatency",
        `-b:v ${preset.bitrate}`,
        `-maxrate ${Math.round(bitrateNum * 1.5)}k`,
        `-bufsize ${bitrateNum * 2}k`,
        "-threads 0",
      ];
  }
};

const transcodeQuality = (
  inputUrl: string,
  outputDir: string,
  preset: QualityPreset
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const qualityDir = join(outputDir, preset.name);

    if (!existsSync(qualityDir)) {
      mkdirSync(qualityDir, { recursive: true });
    }

    const playlistPath = join(qualityDir, "playlist.m3u8");
    const segmentPath = join(qualityDir, "segment_%05d.m4s");

    const command = ffmpeg(inputUrl);

    command.inputOptions([
      "-re",
      "-fflags +genpts+nobuffer",
      "-flags low_delay",
    ]);

    const outputOptions = [
      ...getEncoderOptions(preset),
      `-s ${preset.width}x${preset.height}`,
      "-c:a aac",
      `-b:a ${preset.audioBitrate}`,
      "-f hls",
      `-hls_time ${LL_HLS_SETTINGS.segmentDuration}`,
      `-hls_list_size ${LL_HLS_SETTINGS.playlistSize}`,
      `-hls_delete_threshold ${LL_HLS_SETTINGS.deleteThreshold}`,
      "-hls_flags delete_segments+append_list+program_date_time+independent_segments+split_by_time",
      "-hls_segment_type fmp4",
      `-hls_fmp4_init_filename ${preset.name}_init.mp4`,
      `-hls_playlist_type event`,
      `-master_pl_name master.m3u8`,
      `-hls_segment_filename ${segmentPath}`,
    ];

    command
      .outputOptions(outputOptions)
      .output(playlistPath)
      .on("start", (commandLine) => {
        parentPort?.postMessage({
          type: "started",
          quality: preset.name,
          command: commandLine,
        });
      })
      .on("progress", (progress) => {
        parentPort?.postMessage({
          type: "progress",
          quality: preset.name,
          frames: progress.frames,
          fps: progress.currentFps,
          bitrate: progress.currentKbps,
        });
      })
      .on("end", () => {
        parentPort?.postMessage({
          type: "quality_done",
          quality: preset.name,
        });
        resolve();
      })
      .on("error", (err, stdout, stderr) => {
        parentPort?.postMessage({
          type: "error",
          quality: preset.name,
          error: err.message,
          stderr,
        });
        reject(err);
      })
      .run();
  });
};

const generateMasterPlaylist = (outputDir: string, qualities: QualityPreset[]): void => {
  const masterPlaylistPath = join(outputDir, "master.m3u8");

  let content = "#EXTM3U\n";
  content += "#EXT-X-VERSION:7\n";
  content += "#EXT-X-INDEPENDENT-SEGMENTS\n\n";

  for (const quality of qualities) {
    const bandwidth = parseInt(quality.bitrate) * 1000;
    const avgBandwidth = Math.round(bandwidth * 0.8);
    const resolution = `${quality.width}x${quality.height}`;
    const codecs = quality.height >= 1080
      ? "avc1.640028,mp4a.40.2"
      : quality.height >= 720
        ? "avc1.64001f,mp4a.40.2"
        : "avc1.640015,mp4a.40.2";

    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${avgBandwidth},RESOLUTION=${resolution},CODECS="${codecs}",FRAME-RATE=30\n`;
    content += `${quality.name}/playlist.m3u8\n\n`;
  }

  const fs = require("fs");
  fs.writeFileSync(masterPlaylistPath, content);

  parentPort?.postMessage({
    type: "master_playlist_created",
    path: masterPlaylistPath,
  });
};

const transcodeLive = async (task: LiveTranscodeTask): Promise<void> => {
  const { streamId, inputUrl, outputDir, qualities } = task;

  parentPort?.postMessage({
    type: "info",
    message: `Starting live transcoding for stream ${streamId}`,
    hwaccel: HWACCEL,
    inputUrl,
    outputDir,
    qualities: qualities.map((q) => q.name),
  });

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  generateMasterPlaylist(outputDir, qualities);

  const transcodePromises = qualities.map((preset) =>
    transcodeQuality(inputUrl, outputDir, preset)
  );

  try {
    await Promise.all(transcodePromises);
    parentPort?.postMessage({
      type: "done",
      streamId,
    });
  } catch (error: any) {
    parentPort?.postMessage({
      type: "error",
      streamId,
      error: error.message,
    });
    throw error;
  }
};

const task = workerData as LiveTranscodeTask;

if (!task.qualities || task.qualities.length === 0) {
  task.qualities = DEFAULT_QUALITIES;
}

transcodeLive(task)
  .then(() => {
    parentPort?.postMessage({
      type: "complete",
      streamId: task.streamId,
    });
  })
  .catch((error) => {
    parentPort?.postMessage({
      type: "fatal_error",
      streamId: task.streamId,
      error: error.message,
    });
    process.exit(1);
  });

process.on("SIGTERM", () => {
  parentPort?.postMessage({
    type: "shutdown",
    streamId: task.streamId,
  });
  process.exit(0);
});
