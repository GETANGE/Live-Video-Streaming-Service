import { parentPort, workerData } from "worker_threads";
import { TranscodeTask } from "@types";
import ffmpeg from "fluent-ffmpeg";
import { join } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";

const HLS_PLAYLIST_TYPE = "vod";

// Check for hardware acceleration support
const detectHardwareAcceleration = (): "nvenc" | "vaapi" | "videotoolbox" | "cpu" => {
  const hwaccel = process.env.FFMPEG_HWACCEL;
  if (hwaccel) return hwaccel as any;

  try {
    // Check for NVIDIA GPU
    execSync("nvidia-smi", { stdio: "ignore" });
    return "nvenc";
  } catch {
    try {
      // Check for Intel VAAPI (Linux)
      if (existsSync("/dev/dri/renderD128")) {
        return "vaapi";
      }
    } catch {}
  }
  return "cpu";
};

const HWACCEL = detectHardwareAcceleration();

// Watermark configuration
const WATERMARK_PATH = join(__dirname, "../assets/watermarks/logo.png");
const WATERMARK_OPACITY = process.env.WATERMARK_OPACITY || "0.7";
const WATERMARK_PADDING = 20; // pixels from edge
const WATERMARK_SCALE = 0.15; // 15% of video width
const WATERMARK_MOVE_INTERVAL = 4; // seconds before moving to next corner


 // Generate moving watermark overlay expression

// Parse FFmpeg timemark (HH:MM:SS.ms) to seconds
const parseTimemark = (timemark: string): number => {
  const parts = timemark.split(":");
  if (parts.length !== 3) return 0;
  const hours = parseFloat(parts[0] ?? "0") || 0;
  const minutes = parseFloat(parts[1] ?? "0") || 0;
  const seconds = parseFloat(parts[2] ?? "0") || 0;
  return hours * 3600 + minutes * 60 + seconds;
};

const getMovingWatermarkPosition = (): { x: string; y: string } => {
  const p = WATERMARK_PADDING;
  const interval = WATERMARK_MOVE_INTERVAL;
  const cycle = interval * 4; // Total cycle duration (4 positions)

  // X position: left (padding) or right (main_w - overlay_w - padding)
  // Positions: 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left
  // X is LEFT for positions 0,3 and RIGHT for positions 1,2
  const x = `'if(lt(mod(t,${cycle}),${interval}),${p},` +           // 0-4s: top-left (x=padding)
            `if(lt(mod(t,${cycle}),${interval * 2}),W-w-${p},` +    // 4-8s: top-right (x=right)
            `if(lt(mod(t,${cycle}),${interval * 3}),W-w-${p},` +    // 8-12s: bottom-right (x=right)
            `${p})))'`;                                              // 12-16s: bottom-left (x=padding)

  // Y position: top (padding) or bottom (main_h - overlay_h - padding)
  // Y is TOP for positions 0,1 and BOTTOM for positions 2,3
  const y = `'if(lt(mod(t,${cycle}),${interval}),${p},` +           // 0-4s: top-left (y=padding)
            `if(lt(mod(t,${cycle}),${interval * 2}),${p},` +        // 4-8s: top-right (y=padding)
            `if(lt(mod(t,${cycle}),${interval * 3}),H-h-${p},` +    // 8-12s: bottom-right (y=bottom)
            `H-h-${p})))'`;                                          // 12-16s: bottom-left (y=bottom)

  return { x, y };
};

const transcode = (task: TranscodeTask): Promise<void> => {
  return new Promise((resolve, reject) => {
    const { inputPath, outputDir, preset, segmentDuration, duration } = task;
    const playlistPath = join(outputDir, "playlist.m3u8");

    // Check if watermark exists
    const useWatermark = existsSync(WATERMARK_PATH);

    const command = ffmpeg(inputPath);

    // Performance optimization settings
    const ffmpegPreset = process.env.FFMPEG_PRESET || "veryfast";
    const threads = process.env.FFMPEG_THREADS || "2"; // Limit CPU cores to prevent system hang

    // Build encoder options based on hardware acceleration
    const getEncoderOptions = (): string[] => {
      const bitrateNum = parseInt(preset.bitrate);

      switch (HWACCEL) {
        case "nvenc":
          // NVIDIA GPU acceleration (5-10x faster)
          return [
            "-c:v h264_nvenc",
            "-preset p4", // p1(fastest) to p7(slowest) - p4 is balanced
            "-tune hq",
            "-rc vbr",
            `-b:v ${preset.bitrate}`,
            `-maxrate ${bitrateNum * 1.5}k`,
            `-bufsize ${bitrateNum * 2}k`,
          ];

        case "vaapi":
          // Intel/AMD GPU acceleration (Linux)
          return [
            "-vaapi_device /dev/dri/renderD128",
            "-c:v h264_vaapi",
            `-b:v ${preset.bitrate}`,
            `-maxrate ${bitrateNum * 1.5}k`,
            `-bufsize ${bitrateNum * 2}k`,
          ];

        default:
          // CPU encoding (optimized for speed)
          return [
            "-c:v libx264",
            `-preset ${ffmpegPreset}`,
            "-tune fastdecode",
            "-crf 23",
            `-b:v ${preset.bitrate}`,
            `-maxrate ${preset.bitrate}`,
            `-bufsize ${bitrateNum * 2}k`,
            `-threads ${threads}`,
          ];
      }
    };

    // Base output options - optimized for speed
    const outputOptions: string[] = [
      ...getEncoderOptions(),
      "-c:a aac",
      `-b:a ${preset.audioBitrate}`,
      "-movflags +faststart",
      `-hls_time ${segmentDuration}`,
      `-hls_playlist_type ${HLS_PLAYLIST_TYPE}`,
      `-hls_segment_filename ${join(outputDir, "segment_%03d.ts")}`,
    ];

    // Log which encoder is being used
    parentPort?.postMessage({
      type: "info",
      quality: preset.name,
      message: `Using ${HWACCEL.toUpperCase()} encoder`,
    });

    if (useWatermark) {
      // Add watermark as second input
      command.input(WATERMARK_PATH);

      // Calculate watermark size based on video width
      const watermarkWidth = Math.round(preset.width * WATERMARK_SCALE);

      // Get moving position expressions
      const { x, y } = getMovingWatermarkPosition();

      // Complex filter graph:
      // 1. Scale and pad video
      // 2. Scale watermark and apply opacity
      // 3. Overlay watermark with moving position (TikTok-style)
      const complexFilter = [
        `[0:v]scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2[video]`,
        `[1:v]scale=${watermarkWidth}:-1,format=rgba,colorchannelmixer=aa=${WATERMARK_OPACITY}[wm]`,
        `[video][wm]overlay=x=${x}:y=${y}[outv]`
      ].join(";");

      outputOptions.unshift(
        "-filter_complex", complexFilter,
        "-map", "[outv]",
        "-map", "0:a?"
      );
    } else {
      // Simple video filter without watermark
      const scaleFilter = `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`;
      outputOptions.unshift("-vf", scaleFilter);
    }

    command
      .outputOptions(outputOptions)
      .output(playlistPath)
      .on("progress", (progress) => {
        // Calculate percentage from timemark since progress.percent is unreliable with complex filters
        let percent = 0;
        if (progress.timemark && duration > 0) {
          const currentSeconds = parseTimemark(progress.timemark);
          percent = Math.min((currentSeconds / duration) * 100, 100);
        } else if (progress.percent) {
          percent = progress.percent;
        }

        parentPort?.postMessage({
          type: "progress",
          quality: preset.name,
          percent,
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
    parentPort?.postMessage({
      type: "done",
      quality: task.preset.name,
    });
  })
  .catch((error) => {
    parentPort?.postMessage({
      type: "error",
      quality: task.preset.name,
      error: error.message,
    });
  });
