import { parentPort, workerData } from "worker_threads";
import { TranscodeTask } from "@types";
import ffmpeg from "fluent-ffmpeg";
import { join } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";

const HLS_PLAYLIST_TYPE = "vod";

const detectHardwareAcceleration = (): "nvenc" | "vaapi" | "videotoolbox" | "cpu" => {
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

const WATERMARK_PATH = join(__dirname, "../assets/watermarks/logo.png");
const WATERMARK_OPACITY = process.env.WATERMARK_OPACITY || "0.7";
const WATERMARK_PADDING = 20;
const WATERMARK_SCALE = 0.15;
const WATERMARK_MOVE_INTERVAL = 4;

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
  const cycle = interval * 4;

  const x = `'if(lt(mod(t,${cycle}),${interval}),${p},` +
            `if(lt(mod(t,${cycle}),${interval * 2}),W-w-${p},` +
            `if(lt(mod(t,${cycle}),${interval * 3}),W-w-${p},` +
            `${p})))'`;

  const y = `'if(lt(mod(t,${cycle}),${interval}),${p},` +
            `if(lt(mod(t,${cycle}),${interval * 2}),${p},` +
            `if(lt(mod(t,${cycle}),${interval * 3}),H-h-${p},` +
            `H-h-${p})))'`;

  return { x, y };
};

const transcode = (task: TranscodeTask): Promise<void> => {
  return new Promise((resolve, reject) => {
    const { inputPath, outputDir, preset, segmentDuration, duration } = task;
    const playlistPath = join(outputDir, "playlist.m3u8");

    const useWatermark = existsSync(WATERMARK_PATH);
    const command = ffmpeg(inputPath);

    const ffmpegPreset = process.env.FFMPEG_PRESET || "veryfast";
    const threads = process.env.FFMPEG_THREADS || "2";

    const getEncoderOptions = (): string[] => {
      const bitrateNum = parseInt(preset.bitrate);

      switch (HWACCEL) {
        case "nvenc":
          return [
            "-c:v h264_nvenc",
            "-preset p4",
            "-tune hq",
            "-rc vbr",
            `-b:v ${preset.bitrate}`,
            `-maxrate ${bitrateNum * 1.5}k`,
            `-bufsize ${bitrateNum * 2}k`,
          ];

        case "vaapi":
          return [
            "-vaapi_device /dev/dri/renderD128",
            "-c:v h264_vaapi",
            `-b:v ${preset.bitrate}`,
            `-maxrate ${bitrateNum * 1.5}k`,
            `-bufsize ${bitrateNum * 2}k`,
          ];

        default:
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

    const outputOptions: string[] = [
      ...getEncoderOptions(),
      "-c:a aac",
      `-b:a ${preset.audioBitrate}`,
      "-movflags +faststart",
      `-hls_time ${segmentDuration}`,
      `-hls_playlist_type ${HLS_PLAYLIST_TYPE}`,
      `-hls_segment_filename ${join(outputDir, "segment_%03d.ts")}`,
    ];

    parentPort?.postMessage({
      type: "info",
      quality: preset.name,
      message: `Using ${HWACCEL.toUpperCase()} encoder`,
    });

    if (useWatermark) {
      command.input(WATERMARK_PATH);

      const watermarkWidth = Math.round(preset.width * WATERMARK_SCALE);
      const { x, y } = getMovingWatermarkPosition();

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
      const scaleFilter = `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`;
      outputOptions.unshift("-vf", scaleFilter);
    }

    command
      .outputOptions(outputOptions)
      .output(playlistPath)
      .on("progress", (progress) => {
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
