# Livestreaming System Documentation

## Overview

Real-time video broadcasting with:
- RTMP ingest via OBS/streaming software
- Browser-based streaming via Socket.IO
- Multi-quality HLS output (360p, 720p, 1080p, 4K)
- Real-time chat with moderation
- Automatic VOD conversion
- Horizontal scaling with Redis adapter
- Version-based cache invalidation

---

## Architecture

### System Overview
```
                                    Viewers
                                       │
                                       ▼
┌─────────────┐    ┌─────────────┐  ┌─────────────┐
│   Browser   │    │    OBS/     │  │   Mobile    │
│  Streaming  │    │  Software   │  │    App      │
└──────┬──────┘    └──────┬──────┘  └──────┬──────┘
       │                  │                │
       │ Socket.IO        │ RTMP           │ HLS
       ▼                  ▼                ▼
┌─────────────────────────────────────────────────┐
│              Nginx (Load Balancer)              │
│         - API routing (app1/app2/app3)          │
│         - WebSocket (ip_hash sticky)            │
│         - HLS serving (/live/)                  │
└─────────────────────────────────────────────────┘
       │                  │                │
       ▼                  ▼                ▼
┌─────────────────────────────────────────────────┐
│           App Instances (app1/app2/app3)        │
│    ┌─────────────┐  ┌─────────────┐             │
│    │   RTMP      │  │  Socket.IO  │             │
│    │   Server    │  │   + Redis   │◄── Redis ───┤
│    │   (NMS)     │  │   Adapter   │   Pub/Sub   │
│    └──────┬──────┘  └─────────────┘             │
│           │                                      │
│           ▼                                      │
│    ┌─────────────┐                              │
│    │   FFmpeg    │──► HLS Segments ──► /live/   │
│    │ Transcoder  │                              │
│    └─────────────┘                              │
└─────────────────────────────────────────────────┘
```

### Streaming Flows

Two ingest methods converge into one delivery pipeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FLOW 1: Browser Streaming                   │
│                                                                     │
│  Browser (MediaRecorder)                                            │
│       │                                                             │
│       │ WebSocket + stream-data events                              │
│       ▼                                                             │
│  browser-stream.service.ts                                          │
│       │                                                             │
│       │ FFmpeg (webm → flv)                                         │
│       ▼                                                             │
│  ─────────────────────┐                                             │
└───────────────────────┼─────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RTMP SERVER                                    │
│                  (node-media-server)                                │
└───────────────────────┬─────────────────────────────────────────────┘
                        ▲
                        │
┌───────────────────────┼─────────────────────────────────────────────┐
│  ─────────────────────┘                                             │
│       ▲                                                             │
│       │ RTMP direct                                                 │
│       │                                                             │
│  OBS / Streamlabs / External encoder                                │
│                                                                     │
│                         FLOW 2: OBS/External Streaming              │
└─────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      COMMON DELIVERY FLOW                           │
│                                                                     │
│  RTMP Server                                                        │
│       │                                                             │
│       ▼                                                             │
│  live-transcode.worker.ts                                           │
│       │                                                             │
│       ├──► 360p  (800k)   ──┐                                       │
│       ├──► 720p  (2500k)  ──┼──► master.m3u8                        │
│       ├──► 1080p (5000k)  ──┤                                       │
│       └──► 4K    (10000k) ──┘                                       │
│                                                                     │
│       ▼                                                             │
│  Nginx (live-edge) → Viewers (Adaptive Bitrate)                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Chat Message Flow
```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Client    │      │  Socket.IO  │      │   Redis     │      │  RabbitMQ   │
│  (Viewer)   │      │   Server    │      │   Pub/Sub   │      │   Queue     │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │                    │
       │ 1. authenticate    │                    │                    │
       │ (JWT token)        │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │ 2. join-chat       │                    │                    │
       │ {streamId}         │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │ 3. send-message    │                    │                    │
       │ {streamId, msg}    │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ 4. Validate &      │                    │
       │                    │    Save to DB      │                    │
       │                    ├──────────┐         │                    │
       │                    │          │         │                    │
       │                    │◄─────────┘         │                    │
       │                    │                    │                    │
       │                    │ 5. Emit new-message│                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │ 6. new-message     │◄───────────────────┤ Broadcast to       │
       │◄───────────────────┤    (all instances) │ all instances      │
       │                    │                    │                    │
       │                    │ 7. Queue async     │                    │
       │                    │    (flagging,cache)│                    │
       │                    ├───────────────────────────────────────►│
       │                    │                    │                    │
```

### VOD Conversion Flow
```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Stream    │      │  RabbitMQ   │      │   FFmpeg    │      │   MinIO     │
│    Ends     │      │   Queue     │      │   Worker    │      │  Storage    │
└──────┬──────┘      └──────┬──────┘      └──────┬──────┘      └──────┬──────┘
       │                    │                    │                    │
       │ 1. STREAM_END      │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │ 2. VOD_CONVERT     │                    │                    │
       ├───────────────────►│                    │                    │
       │                    │                    │                    │
       │                    │ 3. Consume         │                    │
       │                    ├───────────────────►│                    │
       │                    │                    │                    │
       │                    │                    │ 4. Get HLS         │
       │                    │                    │    segments        │
       │                    │                    ├───────────────────►│
       │                    │                    │                    │
       │                    │                    │◄───────────────────┤
       │                    │                    │                    │
       │                    │                    │ 5. Concatenate     │
       │                    │                    ├──────────┐         │
       │                    │                    │          │         │
       │                    │                    │◄─────────┘         │
       │                    │                    │                    │
       │                    │                    │ 6. Upload VOD      │
       │                    │                    ├───────────────────►│
       │                    │                    │                    │
       │                    │ 7. VIDEO_PROCESS   │                    │
       │                    │◄───────────────────┤                    │
       │                    │                    │                    │
       │ 8. Update DB       │                    │                    │
       │    vodVideoId      │                    │                    │
       │◄───────────────────┤                    │                    │
       │                    │                    │                    │
```

---

## Components

### 1. Stream Key Management

Stream keys authenticate streamers and link streams to channels.

**Key Format**: `sk_live_{uuid}`

**API Endpoints**:
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/stream-keys/generate` | Generate new key |
| GET | `/api/v1/stream-keys` | List my keys |
| GET | `/api/v1/stream-keys/:id` | Get key details |
| DELETE | `/api/v1/stream-keys/:id` | Revoke key |
| POST | `/api/v1/stream-keys/:id/rotate` | Rotate key |
| GET | `/api/v1/stream-keys/channel/:channelId` | Channel's keys |

**Notifications**:

Stream key operations trigger real-time Socket.IO notifications:

| Event | Message |
|-------|---------|
| `STREAM_KEY_GENERATED` | "New stream key generated for your channel" |
| `STREAM_KEY_REVOKED` | "Stream key has been revoked" |
| `STREAM_KEY_ROTATED` | "Stream key has been rotated. Update your streaming software" |
| `STREAM_KEY_DELETED` | "Stream key has been deleted" |

```javascript
// Client receives
socket.on("notification", (data) => {
  // {
  //   type: "STREAM_KEY_ROTATED",
  //   message: "Stream key has been rotated...",
  //   channelId: "...",
  //   newStreamKeyId: "...",
  //   timestamp: "2025-12-29T..."
  // }
});
```

### 2. RTMP Server (Node Media Server)

Docker-based RTMP server using `illuspas/node-media-server`.

**Docker Configuration**:
```yaml
rtmp-server:
  image: illuspas/node-media-server:latest
  ports:
    - "1935:1935"   # RTMP
    - "8000:8000"   # HTTP/HLS
    - "8443:8443"   # HTTPS
  volumes:
    - rtmp_media:/tmp/media
```

**URLs**:
```
RTMP: rtmp://your-domain.com:1935/live/{stream_key}
HLS:  http://your-domain.com:8000/live/{stream_key}/index.m3u8
```

### 3. Live Transcoder

Worker thread for multi-quality HLS output.

**Quality Presets**:
| Quality | Resolution | Video Bitrate | Audio Bitrate |
|---------|------------|---------------|---------------|
| 360p | 640x360 | 800k | 96k |
| 720p | 1280x720 | 2500k | 128k |
| 1080p | 1920x1080 | 5000k | 192k |
| 4K | 3840x2160 | 10000k | 384k |

**Hardware Acceleration**:
- NVENC (NVIDIA GPUs)
- VAAPI (Intel/AMD)
- CPU fallback (libx264)

**HLS Settings**:
```
Segment Duration: 2 seconds
Playlist Size: 6 segments
Delete Threshold: 10 segments
Flags: delete_segments, append_list, omit_endlist
```

**Viewer Experience**:
```
┌─────────────────────────────────────┐
│         Live Stream Video           │
│                                     │
│    Quality: ▼                       │
│    ○ Auto (Recommended)             │
│    ○ 4K (2160p)                     │
│    ○ 1080p                          │
│    ● 720p  ←                        │
│    ○ 360p                           │
└─────────────────────────────────────┘
```

### 4. Browser Streaming

Socket.IO bridge for browser-based streaming with Redis-backed state.

**Architecture**:
```
Browser (MediaRecorder)
    │
    │ WebSocket chunks (webm)
    ▼
browser-stream.service.ts
    │
    ├── Local Map (FFmpeg process + Socket refs)
    │
    └── Redis (stream metadata)
            │
            ├── browserstream:{version}:stream:{key}
            └── browserstream:{version}:active
```

**Safeguards**:
| Protection | Description |
|------------|-------------|
| `try/finally` cleanup | Map entry deleted even on error |
| Periodic cleanup job | Runs every 60s, removes stale streams |
| Stream timeout | Force-kills streams > 4 hours |
| Orphan detection | Cleans Redis entries without local process |

**Socket.IO Namespace**: `/browser-stream`

**Events**:
| Event | Direction | Description |
|-------|-----------|-------------|
| `start-stream` | Client→Server | Start streaming with key |
| `stream-data` | Client→Server | Send media chunks |
| `stop-stream` | Client→Server | Stop streaming |
| `stream-ready` | Server→Client | Connection established |
| `stream-ended` | Server→Client | Stream terminated |
| `error` | Server→Client | Error occurred |

### 5. Live Chat

Real-time chat with moderation and Redis-backed word filtering.

**Features**:
- Rate limiting (configurable per stream)
- Slow mode support (0-300 seconds)
- Word filtering (Redis-stored, version-based)
- Spam detection (caps, repeated chars, links, duplicates)
- Message pinning/highlighting
- Moderation: mute, ban, unban

**Socket.IO Namespace**: `/chat`

**Events**:
| Event | Direction | Description |
|-------|-----------|-------------|
| `authenticate` | Client→Server | Auth with JWT |
| `join-chat` | Client→Server | Join chat room |
| `send-message` | Client→Server | Send message |
| `new-message` | Server→Client | Message broadcast |
| `message-deleted` | Server→Client | Message deleted |
| `user-muted` | Server→Client | User muted |
| `user-banned` | Server→Client | User banned |
| `user-unbanned` | Server→Client | User unbanned |

### 6. VOD Conversion

Automatic post-stream processing.

**Process**:
1. Stream ends → `VOD_CONVERT` event queued
2. HLS segments concatenated via FFmpeg
3. Video uploaded to MinIO
4. `VIDEO_PROCESS` event published
5. LiveStream updated with `vodVideoId`
6. Chat messages retained

---

## Caching Strategy

### Version-Based Cache Invalidation

All cache modules follow a consistent pattern:

```typescript
const VERSION_KEY = "module:version";

const cacheKey = (version: string, key: string) =>
  `module:${version}:${key}`;

const getVersion = async (): Promise<string> => {
  let version = await redisClient.get(VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(VERSION_KEY, version);
  }
  return version;
};

export const getCacheKeys = async () => {
  const version = await getVersion();
  return {
    byId: (id: string) => cacheKey(version, `id:${id}`),
    // ...
  };
};

export const invalidateCache = async (): Promise<void> => {
  await redisClient.incr(VERSION_KEY);
};
```

### Cache Modules

| Module | Keys | TTL |
|--------|------|-----|
| `livestream` | byId, byStreamKey, byChannel, active, viewerCount | 24h |
| `chat` | history, pinned, message | 5m |
| `streamkey` | byId, byKey, byUser, byChannel | 1h |
| `viewer` | viewers, socketStreams | 24h |
| `browserstream` | stream, active | 24h |
| `wordfilter` | blocked, patterns, recentMessages | - |

---

## Database Models

### LiveStream
```prisma
model LiveStream {
  id              String        @id @default(uuid())
  title           String
  description     String?
  channelId       String
  streamerId      String
  status          StreamStatus  @default(IDLE)
  streamKey       String        @unique
  hlsUrl          String?
  peakViewers     Int           @default(0)
  currentViewers  Int           @default(0)
  totalViews      Int           @default(0)
  startedAt       DateTime?
  endedAt         DateTime?
  duration        Int           @default(0)
  vodVideoId      String?       @unique
}

enum StreamStatus {
  IDLE
  LIVE
  ENDED
  PROCESSING_VOD
}
```

### StreamKey
```prisma
model StreamKey {
  id          String          @id @default(uuid())
  key         String          @unique
  userId      String
  channelId   String
  status      StreamKeyStatus @default(ACTIVE)
  label       String?
  lastUsedAt  DateTime?
  expiresAt   DateTime?
}

enum StreamKeyStatus {
  ACTIVE
  REVOKED
  EXPIRED
}
```

### ChatMessage
```prisma
model ChatMessage {
  id            String            @id @default(uuid())
  streamId      String
  userId        String
  message       String
  status        ChatMessageStatus @default(VISIBLE)
  isHighlighted Boolean           @default(false)
  isPinned      Boolean           @default(false)
}

enum ChatMessageStatus {
  VISIBLE
  DELETED
  FLAGGED
}
```

### ModerationLog
```prisma
model ModerationLog {
  id           String           @id @default(uuid())
  streamId     String
  moderatorId  String
  targetUserId String
  action       ModerationAction
  reason       String?
  expiresAt    DateTime?
}

enum ModerationAction {
  MUTE
  BAN
  WARN
  UNBAN
}
```

---

## Queue Configuration

### Queues

| Queue | Name | Routing Key | Prefetch |
|-------|------|-------------|----------|
| VIDEO | `video_processing_queue` | `video.process` | 2 |
| LIVE | `live_processing_queue` | `live.process` | 5 |
| GENERAL | `general_queue` | `general.events` | 200 |

### Event Types

**VIDEO_EVENTS** → VIDEO queue:
- `VIDEO_PROCESS`, `VIDEO_TRANSCODE`, `VIDEO_THUMBNAIL`, `VIDEO_DELETE`, `CHANNEL_DELETED`

**LIVE_EVENTS** → LIVE queue:
- `STREAM_START`, `STREAM_END`, `STREAM_TRANSCODE`, `VOD_CONVERT`, `CHAT_MESSAGE`, `MODERATION_ACTION`

**NOTIFICATION_EVENTS** → GENERAL queue:
- `STREAM_KEY_GENERATED`, `STREAM_KEY_REVOKED`, `STREAM_KEY_ROTATED`, `STREAM_KEY_DELETED`

### Priorities

| Priority | Value | Use Case |
|----------|-------|----------|
| HIGH | 9 | Moderation actions |
| MEDIUM | 5 | Stream events, VOD conversion |
| LOW | 1 | Chat persistence, notifications |

---

## Scaling

### Architecture
```
Client → Nginx (ip_hash) → app1/app2/app3 → Redis Pub/Sub
```

| Component | Scaling Method |
|-----------|----------------|
| App Instances | Nginx load balancing (3 instances) |
| WebSocket | Socket.IO + Redis adapter |
| State | Redis (shared across instances) |
| Jobs | RabbitMQ (distributed) |
| Browser Streams | Redis metadata + local process refs |

### Socket.IO Redis Adapter

```typescript
const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

### Capacity

| Setup | Concurrent Users |
|-------|------------------|
| 3 instances + Redis | ~50k |
| Kubernetes + Redis Cluster | 200k+ |

---

## API Reference

### Livestream
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/livestreams` | No | List streams |
| GET | `/api/v1/livestreams/live` | No | Active streams |
| GET | `/api/v1/livestreams/:id` | No | Stream details |
| POST | `/api/v1/livestreams` | Yes | Create stream |
| PUT | `/api/v1/livestreams/:id` | Yes | Update stream |
| POST | `/api/v1/livestreams/:id/end` | Yes | End stream |
| DELETE | `/api/v1/livestreams/:id` | Yes | Delete stream |
| GET | `/api/v1/livestreams/:id/stats` | No | Stream stats |
| GET | `/api/v1/livestreams/channel/:channelId` | No | Channel streams |
| GET | `/api/v1/livestreams/my` | Yes | My streams |

### Chat
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/chat/:streamId/history` | No | Chat history |
| GET | `/api/v1/chat/:streamId/pinned` | No | Pinned messages |
| DELETE | `/api/v1/chat/:streamId/messages/:msgId` | Yes | Delete message |
| POST | `/api/v1/chat/:streamId/pin/:msgId` | Yes | Pin message |
| POST | `/api/v1/chat/:streamId/unpin/:msgId` | Yes | Unpin message |
| POST | `/api/v1/chat/:streamId/mute/:userId` | Yes | Mute user |
| POST | `/api/v1/chat/:streamId/ban/:userId` | Yes | Ban user |
| POST | `/api/v1/chat/:streamId/unban/:userId` | Yes | Unban user |
| GET | `/api/v1/chat/:streamId/banned` | Yes | Banned users |
| GET | `/api/v1/chat/:streamId/logs` | Yes | Moderation logs |
| POST | `/api/v1/chat/:streamId/slow-mode` | Yes | Set slow mode |

### Stream Keys
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/stream-keys/generate` | Yes | Generate key |
| GET | `/api/v1/stream-keys` | Yes | My keys |
| GET | `/api/v1/stream-keys/:id` | Yes | Get key |
| DELETE | `/api/v1/stream-keys/:id` | Yes | Revoke key |
| POST | `/api/v1/stream-keys/:id/rotate` | Yes | Rotate key |
| DELETE | `/api/v1/stream-keys/:id/delete` | Yes | Delete key |
| GET | `/api/v1/stream-keys/channel/:channelId` | Yes | Channel keys |

---

## Environment Variables

```env
# RTMP
RTMP_HOST=localhost
RTMP_INTERNAL_URL=rtmp://rtmp-server:1935

# HLS
HLS_BASE_URL=http://localhost:8000

# Redis
REDIS_URL=redis://localhost:6379

# Server
SERVER_ID=app1

# FFmpeg
FFMPEG_HWACCEL=nvenc  # nvenc, vaapi, or cpu

# Live Settings
LIVE_HLS_SEGMENT_DURATION=2
LIVE_HLS_PLAYLIST_SIZE=6
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `STREAM_KEY_INVALID` | Key doesn't exist |
| `STREAM_KEY_REVOKED` | Key was revoked |
| `STREAM_KEY_EXPIRED` | Key has expired |
| `STREAM_ALREADY_LIVE` | Already broadcasting |
| `STREAM_NOT_LIVE` | Stream is not live |
| `STREAM_NOT_FOUND` | Stream doesn't exist |
| `CHAT_RATE_LIMITED` | Too many messages |
| `CHAT_USER_MUTED` | User is muted |
| `CHAT_USER_BANNED` | User is banned |
| `CHAT_MESSAGE_SPAM` | Message detected as spam |
| `BROWSER_STREAM_ACTIVE` | Stream already active |
| `BROWSER_STREAM_ERROR` | FFmpeg/streaming error |

---

## Files Structure

```
├── configs/
│   └── sockets/
│       ├── live.handler.ts
│       ├── chat.handler.ts
│       ├── browser-stream.handler.ts
│       ├── emitters.ts
│       └── index.ts
├── controllers/
│   ├── livestream.controller.ts
│   ├── streamkey.controller.ts
│   └── chat.controller.ts
├── services/
│   ├── livestream.service.ts
│   ├── streamkey.service.ts
│   ├── chat.service.ts
│   └── browser-stream.service.ts
├── repository/
│   ├── livestream.repository.ts
│   ├── streamkey.repository.ts
│   ├── chat.repository.ts
│   └── moderation.repository.ts
├── helpers/
│   ├── livestream.helper.ts
│   ├── chat.helper.ts
│   └── cacheInvalidations/
│       ├── livestreamCacheInvalidation.ts
│       ├── chatCacheInvalidation.ts
│       ├── streamkeyCacheInvalidation.ts
│       ├── viewerCacheInvalidation.ts
│       └── browserStreamCacheInvalidation.ts
├── workers/
│   └── live-transcode.worker.ts
├── events/
│   ├── producers/
│   │   └── streaming.publisher.ts
│   └── consumers/
│       ├── live.consumer.ts
│       └── eventHandlers/
│           ├── live_handlers/
│           │   ├── stream_start.ts
│           │   ├── stream_end.ts
│           │   ├── vod_convert.ts
│           │   ├── chat_message.ts
│           │   └── moderation_action.ts
│           └── notification_handlers/
│               └── stream_key_notification.ts
├── utils/
│   └── wordFilter.ts
└── routes/
    ├── livestream.route.ts
    ├── streamkey.route.ts
    └── chat.route.ts
```
