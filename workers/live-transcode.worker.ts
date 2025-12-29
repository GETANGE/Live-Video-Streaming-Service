import { parentPort, workerData } from "worker_threads";
import ffmpeg from "fluent-ffmpeg";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";

// Live transcoding configuration
interface LiveTranscodeTask {
  streamId: string;
  inputUrl: string; // RTMP URL
  outputDir: string;
  qualities: QualityPreset[];
}

interface QualityPreset {
  name: string;
  width: number;
  height: number;
  bitrate: string;
  audioBitrate: string;
}

// Low-latency HLS settings for live streaming
const LIVE_HLS_SETTINGS = {
  segmentDuration: 2, // 2 seconds for lower latency
  playlistSize: 6, // Keep 6 segments (12s buffer)
  deleteThreshold: 10, // Delete segments after 10 from playlist
};

// Default quality presets for live streaming
const DEFAULT_QUALITIES: QualityPreset[] = [
  { name: "360p", width: 640, height: 360, bitrate: "800k", audioBitrate: "96k" },
  { name: "720p", width: 1280, height: 720, bitrate: "2500k", audioBitrate: "128k" },
  { name: "1080p", width: 1920, height: 1080, bitrate: "5000k", audioBitrate: "192k" },
  { name: "2160", width: 3840, height: 2160, bitrate: "10000k", audioBitrate: "384k" },
];

// Check for hardware acceleration support
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

// Get encoder options based on hardware acceleration
const getEncoderOptions = (preset: QualityPreset): string[] => {
  const bitrateNum = parseInt(preset.bitrate);

  switch (HWACCEL) {
    case "nvenc":
      return [
        "-c:v h264_nvenc",
        "-preset p1", // Fastest preset for live
        "-tune ll", // Low latency tune
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
        "-preset ultrafast", // Fastest for live
        "-tune zerolatency", // Zero latency for live
        `-b:v ${preset.bitrate}`,
        `-maxrate ${preset.bitrate}`,
        `-bufsize ${preset.bitrate}`,
        "-threads 2",
      ];
  }
};

// Transcode a single quality variant
const transcodeQuality = (
  inputUrl: string,
  outputDir: string,
  preset: QualityPreset
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const qualityDir = join(outputDir, preset.name);

    // Ensure output directory exists
    if (!existsSync(qualityDir)) {
      mkdirSync(qualityDir, { recursive: true });
    }

    const playlistPath = join(qualityDir, "playlist.m3u8");
    const segmentPath = join(qualityDir, "segment_%05d.ts");

    const command = ffmpeg(inputUrl);

    // Input options for live stream
    command.inputOptions([
      "-re", // Read input at native frame rate
      "-fflags +genpts+nobuffer", // Generate timestamps, no buffering
      "-flags low_delay", // Low delay mode
    ]);

    // Output options for live HLS
    const outputOptions = [
      ...getEncoderOptions(preset),
      `-s ${preset.width}x${preset.height}`,
      "-c:a aac",
      `-b:a ${preset.audioBitrate}`,
      "-f hls",
      `-hls_time ${LIVE_HLS_SETTINGS.segmentDuration}`,
      `-hls_list_size ${LIVE_HLS_SETTINGS.playlistSize}`,
      `-hls_delete_threshold ${LIVE_HLS_SETTINGS.deleteThreshold}`,
      "-hls_flags delete_segments+append_list+discont_start+omit_endlist",
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

// Generate master playlist for adaptive bitrate streaming
const generateMasterPlaylist = (outputDir: string, qualities: QualityPreset[]): void => {
  const masterPlaylistPath = join(outputDir, "master.m3u8");

  let content = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

  for (const quality of qualities) {
    const bandwidth = parseInt(quality.bitrate) * 1000; // Convert to bits
    const resolution = `${quality.width}x${quality.height}`;

    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
    content += `${quality.name}/playlist.m3u8\n\n`;
  }

  // Write master playlist
  const fs = require("fs");
  fs.writeFileSync(masterPlaylistPath, content);

  parentPort?.postMessage({
    type: "master_playlist_created",
    path: masterPlaylistPath,
  });
};

// Main transcoding function
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

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Generate master playlist first
  generateMasterPlaylist(outputDir, qualities);

  // Start all quality transcodes in parallel
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

// Run transcoding when worker starts
const task = workerData as LiveTranscodeTask;

// Use default qualities if none provided
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

// Handle shutdown signals
process.on("SIGTERM", () => {
  parentPort?.postMessage({
    type: "shutdown",
    streamId: task.streamId,
  });
  process.exit(0);
});
