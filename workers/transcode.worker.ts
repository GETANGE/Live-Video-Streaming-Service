import { parentPort, workerData } from "worker_threads";
import { TranscodeTask } from "@types";
import ffmpeg from "fluent-ffmpeg";
import { join } from "path";
import { existsSync } from "fs";

const HLS_PLAYLIST_TYPE = "vod";

// Watermark configuration
const WATERMARK_PATH = join(__dirname, "../assets/watermarks/logo.png");
const WATERMARK_OPACITY = process.env.WATERMARK_OPACITY || "0.7";
const WATERMARK_PADDING = 20; // pixels from edge
const WATERMARK_SCALE = 0.15; // 15% of video width
const WATERMARK_MOVE_INTERVAL = 4; // seconds before moving to next corner


 // Generate moving watermark overlay expression

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
    const { inputPath, outputDir, preset, segmentDuration } = task;
    const playlistPath = join(outputDir, "playlist.m3u8");

    // Check if watermark exists
    const useWatermark = existsSync(WATERMARK_PATH);

    const command = ffmpeg(inputPath);

    // Base output options
    const outputOptions: string[] = [
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
    ];

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
