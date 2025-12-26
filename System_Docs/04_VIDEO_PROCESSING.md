# Video Processing Documentation

## Overview

The video processing system handles video uploads, transcoding to HLS (HTTP Live Streaming) format with adaptive bitrate, and storage to MinIO/CDN.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VIDEO PROCESSING PIPELINE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐ │
│  │  Upload  │───▶│  Queue   │───▶│ Transcode│───▶│  MinIO   │───▶│  CDN   │ │
│  │  (API)   │    │(RabbitMQ)│    │ (FFmpeg) │    │ (Storage)│    │(Cloudinary)│
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └────────┘ │
│                                        │                                    │
│                                        ▼                                    │
│                              ┌──────────────────┐                           │
│                              │  Worker Threads  │                           │
│                              │  (Parallel HLS)  │                           │
│                              └──────────────────┘                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## HLS (HTTP Live Streaming)

### What is HLS?

HLS splits video into small segments (.ts files) with a playlist (.m3u8) that allows adaptive bitrate streaming.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HLS STRUCTURE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Original Video (1080p, 2GB)                                                │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     FFmpeg Transcoding                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│         │                                                                   │
│         ├──────────────────┬──────────────────┬──────────────────┐          │
│         ▼                  ▼                  ▼                  ▼          │
│  ┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐    │
│  │   1080p    │     │    720p    │     │    480p    │     │    360p    │    │
│  │  5000kbps  │     │  2500kbps  │     │  1000kbps  │     │   600kbps  │    │
│  └────────────┘     └────────────┘     └────────────┘     └────────────┘    │
│         │                  │                  │                  │          │
│         ▼                  ▼                  ▼                  ▼          │
│  ┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐    │
│  │segment0.ts │     │segment0.ts │     │segment0.ts │     │segment0.ts │    │
│  │segment1.ts │     │segment1.ts │     │segment1.ts │     │segment1.ts │    │
│  │segment2.ts │     │segment2.ts │     │segment2.ts │     │segment2.ts │    │
│  │  ...       │     │  ...       │     │  ...       │     │  ...       │    │
│  │1080p.m3u8  │     │720p.m3u8   │     │480p.m3u8   │     │360p.m3u8   │    │
│  └────────────┘     └────────────┘     └────────────┘     └────────────┘    │
│         │                  │                  │                  │          │
│         └──────────────────┴────────┬─────────┴──────────────────┘          │
│                                     ▼                                       │
│                          ┌──────────────────┐                               │
│                          │   master.m3u8    │  (Master playlist)            │
│                          └──────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Master Playlist (master.m3u8)

```m3u8
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
480p/playlist.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360
360p/playlist.m3u8
```

### Quality Playlist (720p/playlist.m3u8)

```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0

#EXTINF:4.000000,
segment0.ts
#EXTINF:4.000000,
segment1.ts
#EXTINF:4.000000,
segment2.ts
#EXT-X-ENDLIST
```

---

## Quality Presets

```typescript
// Location: services/ffmpeg.service.ts

const QUALITY_PRESETS = [
  { name: "360p",  width: 640,  height: 360,  bitrate: "600k",  audioBitrate: "64k"  },
  { name: "480p",  width: 854,  height: 480,  bitrate: "1000k", audioBitrate: "96k"  },
  { name: "720p",  width: 1280, height: 720,  bitrate: "2500k", audioBitrate: "128k" },
  { name: "1080p", width: 1920, height: 1080, bitrate: "5000k", audioBitrate: "192k" },
];
```

---

## Worker Threads (Parallel Transcoding)

### Why Worker Threads?

FFmpeg transcoding is CPU-intensive. Using worker threads allows parallel processing of multiple quality levels.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PARALLEL TRANSCODING                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         ┌─────────────────┐                                 │
│                         │   Main Thread   │                                 │
│                         │  (Orchestrator) │                                 │
│                         └────────┬────────┘                                 │
│                                  │                                          │
│              ┌───────────────────┼───────────────────┐                      │
│              │                   │                   │                      │
│              ▼                   ▼                   ▼                      │
│     ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐             │
│     │  Worker Thread  │ │  Worker Thread  │ │  Worker Thread  │             │
│     │     (360p)      │ │     (480p)      │ │     (720p)      │             │
│     │   FFmpeg CLI    │ │   FFmpeg CLI    │ │   FFmpeg CLI    │             │
│     └────────┬────────┘ └────────┬────────┘ └────────┬────────┘             │
│              │                   │                   │                      │
│              ▼                   ▼                   ▼                      │
│     ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐             │
│     │  360p segments  │ │  480p segments  │ │  720p segments  │             │
│     └─────────────────┘ └─────────────────┘ └─────────────────┘             │
│                                                                             │
│  Sequential: 4 qualities × 5 min = 20 minutes                               │
│  Parallel:   4 qualities ÷ workers = ~5-7 minutes                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Worker Pool

```typescript
// Location: utils/workerPool.ts

const MAX_WORKERS = Math.max(2, os.cpus().length - 1);

export const runTranscodeTask = (task: TranscodeTask): Promise<WorkerResult> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./workers/transcode.worker.ts");

    worker.postMessage(task);

    worker.on("message", (result) => {
      resolve(result);
      worker.terminate();
    });

    worker.on("error", reject);
  });
};
```

### Transcode Worker

```typescript
// Location: workers/transcode.worker.ts

parentPort?.on("message", async (task: TranscodeTask) => {
  const { inputPath, outputDir, preset, segmentDuration } = task;

  // FFmpeg command for HLS
  const args = [
    "-i", inputPath,
    "-vf", `scale=${preset.width}:${preset.height}`,
    "-c:v", "libx264",
    "-b:v", preset.bitrate,
    "-c:a", "aac",
    "-b:a", preset.audioBitrate,
    "-f", "hls",
    "-hls_time", segmentDuration.toString(),
    "-hls_segment_filename", `${outputDir}/${preset.name}/segment%d.ts`,
    `${outputDir}/${preset.name}/playlist.m3u8`,
  ];

  await execAsync(`ffmpeg ${args.join(" ")}`);

  parentPort?.postMessage({ quality: preset.name, success: true });
});
```

---

## Upload Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VIDEO UPLOAD FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. POST /api/v1/uploads/video                                              │
│     ├── Validate file (type, size)                                          │
│     ├── Save to temp directory                                              │
│     ├── Create Video record (status: PROCESSING)                            │
│     └── Queue VIDEO_PROCESS event                                           │
│                                                                             │
│  2. VIDEO_PROCESS Handler                                                   │
│     ├── Get video duration (ffprobe)                                        │
│     ├── Create output directory                                             │
│     ├── Spawn worker threads for each quality                               │
│     │   └── Emit progress via Socket.IO                                     │
│     ├── Generate master playlist                                            │
│     ├── Upload all files to MinIO                                           │
│     ├── Sync to CDN (Cloudinary)                                            │
│     ├── Update Video record with URLs                                       │
│     └── Clean up temp files                                                 │
│                                                                             │
│  3. Response to client                                                      │
│     └── Video available at streaming URL                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Progress Reporting

Real-time progress updates via Socket.IO:

```typescript
// Emit progress during transcoding
emitVideoProgress(userId, videoId, {
  stage: "transcoding",
  quality: "720p",
  percent: 45,
  message: "Transcoding 720p..."
});
```

### Progress Stages

| Stage | Description |
|-------|-------------|
| `uploading` | File being uploaded |
| `processing` | Started processing |
| `transcoding` | FFmpeg transcoding |
| `uploading_storage` | Uploading to MinIO |
| `syncing_cdn` | Syncing to CDN |
| `completed` | Done |
| `failed` | Error occurred |

---

## Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STORAGE LAYERS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │   Temp Storage  │  /tmp/uploads/                                         │
│  │   (Local Disk)  │  - Original uploaded file                              │
│  └────────┬────────┘  - Deleted after processing                            │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │     MinIO       │  videos/{videoId}/                                     │
│  │ (Object Storage)│  ├── master.m3u8                                       │
│  │                 │  ├── 360p/                                             │
│  │   Primary       │  │   ├── playlist.m3u8                                 │
│  │   Storage       │  │   └── segment0.ts, segment1.ts...                   │
│  └────────┬────────┘  ├── 720p/                                             │
│           │           └── 1080p/                                            │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │   Cloudinary    │  CDN-optimized delivery                                │
│  │      (CDN)      │  - Global edge caching                                 │
│  │                 │  - Automatic format optimization                       │
│  │   Edge Cache    │  - Bandwidth optimization                              │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## MinIO Bucket Structure

```
videos/
├── {videoId}/
│   ├── master.m3u8
│   ├── original.mp4          (optional - keep original)
│   ├── thumbnail.jpg
│   ├── 360p/
│   │   ├── playlist.m3u8
│   │   ├── segment0.ts
│   │   ├── segment1.ts
│   │   └── ...
│   ├── 480p/
│   │   └── ...
│   ├── 720p/
│   │   └── ...
│   └── 1080p/
│       └── ...
```

---

## FFmpeg Commands

### Get Video Duration

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4
```

### Transcode to HLS

```bash
ffmpeg -i input.mp4 \
  -vf scale=1280:720 \
  -c:v libx264 \
  -b:v 2500k \
  -c:a aac \
  -b:a 128k \
  -f hls \
  -hls_time 4 \
  -hls_segment_filename "720p/segment%d.ts" \
  "720p/playlist.m3u8"
```

### Generate Thumbnail

```bash
ffmpeg -i input.mp4 -ss 00:00:05 -vframes 1 thumbnail.jpg
```

---

## Watermarking (TikTok-Style)

Videos are automatically watermarked during transcoding to protect content and brand your videos.

### Features

| Feature | Description |
|---------|-------------|
| **Moving Position** | Watermark cycles through all 4 corners every 16 seconds |
| **Semi-Transparent** | 70% opacity (configurable) |
| **Auto-Scaling** | Scales to 15% of video width per quality |
| **Anti-Removal** | Moving position makes automated removal difficult |

### Watermark Movement Pattern

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     WATERMARK POSITION CYCLE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   0-4 seconds          4-8 seconds          8-12 seconds       12-16 sec   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐│
│  │[WM]          │    │          [WM]│    │              │    │            ││
│  │              │    │              │    │              │    │            ││
│  │              │    │              │    │              │    │            ││
│  │              │    │              │    │          [WM]│    │[WM]        ││
│  └──────────────┘    └──────────────┘    └──────────────┘    └────────────┘│
│    Top-Left            Top-Right          Bottom-Right       Bottom-Left   │
│                                                                             │
│                        (Then cycle repeats)                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Configuration

```typescript
// Location: workers/transcode.worker.ts

const WATERMARK_PATH = "assets/watermarks/logo.png";
const WATERMARK_OPACITY = "0.7";           // 0.0 to 1.0
const WATERMARK_PADDING = 20;              // pixels from edge
const WATERMARK_SCALE = 0.15;              // 15% of video width
const WATERMARK_MOVE_INTERVAL = 4;         // seconds per position
```

### Environment Variables (Optional)

```env
WATERMARK_OPACITY=0.7
```

### Setup

1. **Add your logo:**
```bash
# Place your PNG logo (with transparency) at:
assets/watermarks/logo.png
```

2. **Recommended logo specs:**
   - Format: PNG with transparent background
   - Size: 500-1000px width
   - Style: Light colors work better on video content

3. **Rebuild application:**
```bash
docker-compose up -d --build app1 app2 app3
```

### FFmpeg Filter (Moving Watermark)

```bash
ffmpeg -i video.mp4 -i logo.png \
  -filter_complex "
    [0:v]scale=1280:720[video];
    [1:v]scale=192:-1,format=rgba,colorchannelmixer=aa=0.7[wm];
    [video][wm]overlay=x='if(lt(mod(t,16),4),20,if(lt(mod(t,16),8),W-w-20,if(lt(mod(t,16),12),W-w-20,20)))':y='if(lt(mod(t,16),4),20,if(lt(mod(t,16),8),20,if(lt(mod(t,16),12),H-h-20,H-h-20)))'[outv]
  " \
  -map "[outv]" -map 0:a output.mp4
```

### How It Works

1. **During Transcoding**: Watermark is applied when video is transcoded to HLS
2. **All Qualities**: Each quality variant (360p, 720p, 1080p, 2160p) gets watermarked
3. **Permanent**: Watermark is baked into the video segments
4. **No Runtime Overhead**: No processing needed during playback

### Disabling Watermark

To disable watermarking, simply remove or rename the watermark file:

```bash
mv assets/watermarks/logo.png assets/watermarks/logo.png.disabled
```

The transcoder automatically skips watermarking if the file doesn't exist.

---

## Database Model

```prisma
model Video {
  id           String   @id @default(uuid())
  title        String
  description  String?
  duration     Int      @default(0)
  uploadedBy   String?
  channelId    String?

  originalUrl  String?    // MinIO URL
  cdnUrl       String?    // Cloudinary URL
  thumbnailUrl String?
  streamingUrl String?    // master.m3u8 URL
  publicId     String?    // Cloudinary public ID

  // CDN sync tracking
  cdnSynced       Boolean   @default(false)
  cdnSyncedAt     DateTime?
  cdnSyncAttempts Int       @default(0)
}
```

---

## Frontend Player Integration

```html
<!-- Using Video.js with HLS -->
<video-js id="player" class="vjs-default-skin">
  <source src="https://cdn.example.com/videos/{id}/master.m3u8" type="application/x-mpegURL">
</video-js>

<script>
  var player = videojs('player', {
    html5: {
      hls: {
        enableLowInitialPlaylist: true,
        smoothQualityChange: true,
        overrideNative: true
      }
    }
  });
</script>
```

### Adaptive Bitrate

The player automatically switches quality based on network conditions:

```
Network Speed    →    Quality Selected
─────────────────────────────────────
< 1 Mbps              360p
1-2 Mbps              480p
2-4 Mbps              720p
> 4 Mbps              1080p
```
