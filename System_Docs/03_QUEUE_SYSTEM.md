# Queue System Documentation

## Overview

The system uses RabbitMQ for asynchronous message processing with a **Bulkhead Pattern** - separating heavy operations (video processing) from lightweight operations (notifications, payments).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RABBITMQ ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         ┌─────────────────────┐                             │
│                         │  streaming_exchange │                             │
│                         │     (Direct)        │                             │
│                         └──────────┬──────────┘                             │
│                                    │                                        │
│                    ┌───────────────┴───────────────┐                        │
│                    │                               │                        │
│            ┌───────▼───────┐               ┌───────▼───────┐                │
│            │ video.process │               │ general.events│                │
│            │ (routing key) │               │ (routing key) │                │
│            └───────┬───────┘               └───────┬───────┘                │
│                    │                               │                        │
│            ┌───────▼───────┐               ┌───────▼───────┐                │
│            │  VIDEO QUEUE  │               │ GENERAL QUEUE │                │
│            │               │               │               │                │
│            │ Prefetch: 2   │               │ Prefetch: 200 │                │
│            │ (Heavy ops)   │               │ (Light ops)   │                │
│            └───────┬───────┘               └───────┬───────┘                │
│                    │                               │                        │
│            ┌───────▼───────┐               ┌───────▼───────┐                │
│            │VIDEO CONSUMER │               │GENERAL CONSUMER│               │
│            └───────────────┘               └────────────────┘               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Bulkhead Pattern

The Bulkhead Pattern isolates different workloads to prevent one from overwhelming the other.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BULKHEAD PATTERN                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────────┐ │
│  │      VIDEO BULKHEAD         │    │        GENERAL BULKHEAD            │ │
│  │                             │    │                                     │ │
│  │  ┌─────┐ ┌─────┐            │    │  ┌───┐┌───┐┌───┐┌───┐ ... ┌───┐    │ │
│  │  │Job 1│ │Job 2│  (max 2)   │    │  │ 1 ││ 2 ││ 3 ││ 4 │     │200│    │ │
│  │  └─────┘ └─────┘            │    │  └───┘└───┘└───┘└───┘     └───┘    │ │
│  │                             │    │                                     │ │
│  │  Heavy CPU/IO operations    │    │  Lightweight DB/notification ops    │ │
│  │  - Video transcoding        │    │  - Create notifications             │ │
│  │  - Thumbnail generation     │    │  - Update subscriptions             │ │
│  │  - Video deletion           │    │  - Process payments                 │ │
│  │  - Channel deletion         │    │  - Send emails                      │ │
│  └─────────────────────────────┘    └─────────────────────────────────────┘ │
│                                                                             │
│  If video processing is slow,       General operations continue            │
│  it doesn't block notifications     unaffected at full speed               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Queue Configuration

```typescript
// Location: constants/constant.ts

export const QUEUES = {
  VIDEO: {
    name: "video_processing_queue",
    routingKey: "video.process",
    prefetch: 2,        // Only 2 concurrent video jobs
    maxPriority: 10,
  },
  GENERAL: {
    name: "general_queue",
    routingKey: "general.events",
    prefetch: 200,      // 200 concurrent lightweight jobs
    maxPriority: 10,
  },
};

// Events routed to VIDEO queue
export const VIDEO_EVENTS = [
  "VIDEO_PROCESS",
  "VIDEO_TRANSCODE",
  "VIDEO_THUMBNAIL",
  "VIDEO_DELETE",
  "CHANNEL_DELETED",  // Heavy - deletes all channel videos
];
```

---

## Event Types

### VIDEO Queue Events (Heavy Operations)

| Event | Handler | Description |
|-------|---------|-------------|
| `VIDEO_PROCESS` | `video_process.ts` | Transcode video to HLS |
| `VIDEO_THUMBNAIL` | `video_thumbnail.ts` | Upload custom thumbnail |
| `VIDEO_DELETE` | `video_delete.ts` | Delete video from MinIO/CDN |
| `CHANNEL_DELETED` | `channel_deleted.ts` | Delete channel and all videos |

### GENERAL Queue Events (Lightweight Operations)

| Event | Handler | Description |
|-------|---------|-------------|
| `USER_PROFILE_UPDATE` | `update_profile.ts` | Update user profile |
| `SUBSCRIPTION_CREATED` | `subscribe_channel.ts` | New subscription |
| `SUBSCRIPTION_CANCELLED` | `subscribe_cancel.ts` | Subscription cancelled |
| `SUBSCRIPTION_RENEWED` | `subscribe_renew.ts` | Subscription renewed |
| `SUBSCRIPTION_EXPIRED` | `subscribe_expired.ts` | Subscription expired |
| `SUBSCRIPTION_EXPIRING_SOON` | `subscribe_expire_rem.ts` | Expiration reminder |
| `SUBSCRIPTION_BATCH_CREATE` | `subscribe_batch.ts` | Batch subscriptions |
| `NOTIFICATION_MARK_READ` | `notification_read.ts` | Mark notification read |
| `NOTIFICATION_MARK_ALL_READ` | `notification_readAll.ts` | Mark all read |
| `NOTIFICATION_DELETE` | `notification_delete.ts` | Delete notification |
| `PAYMENT_INITIATED` | `payment_initiated.ts` | Payment started |
| `PAYMENT_CALLBACK` | `payment_callback.ts` | M-Pesa callback |
| `CHANNEL_CREATED` | `channel_created.ts` | Channel created |
| `CHANNEL_UPDATED` | `channel_updated.ts` | Channel updated |

---

## Message Flow

### Publishing a Message

```typescript
// Location: events/producers/streaming.publisher.ts

import { QUEUES, VIDEO_EVENTS } from "@constants/constant";

// Automatic routing based on event type
const getRoutingKey = (eventType: string): string => {
  if (VIDEO_EVENTS.includes(eventType)) {
    return QUEUES.VIDEO.routingKey;  // "video.process"
  }
  return QUEUES.GENERAL.routingKey;  // "general.events"
};

export const publishMessage = async (payload) => {
  const routingKey = getRoutingKey(payload.eventType);

  channel.publish(
    "streaming_exchange",
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, priority: payload.priority }
  );
};
```

### Consuming Messages

```typescript
// Location: events/consumers/video.consumer.ts

const videoEventHandlers = {
  VIDEO_PROCESS: handleVideoProcess,
  VIDEO_THUMBNAIL: handleVideoThumbnail,
  VIDEO_DELETE: handleVideoDelete,
  CHANNEL_DELETED: handleChannelDeleted,
};

channel.consume(QUEUES.VIDEO.name, async (msg) => {
  const data = JSON.parse(msg.content.toString());
  const handler = videoEventHandlers[data.eventType];

  try {
    await handler(data.payload);
    channel.ack(msg);
  } catch (err) {
    // Retry logic...
  }
});
```

---

## Retry Mechanism

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RETRY FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Message Received                                                          │
│         │                                                                   │
│         ▼                                                                   │
│   ┌───────────┐     Success      ┌───────────┐                              │
│   │  Process  │─────────────────▶│    ACK    │                              │
│   └─────┬─────┘                  └───────────┘                              │
│         │                                                                   │
│         │ Failure                                                           │
│         ▼                                                                   │
│   ┌───────────────────┐                                                     │
│   │ Retry < MAX (3)?  │                                                     │
│   └─────────┬─────────┘                                                     │
│             │                                                               │
│      ┌──────┴──────┐                                                        │
│      │             │                                                        │
│     YES           NO                                                        │
│      │             │                                                        │
│      ▼             ▼                                                        │
│  ┌────────┐   ┌────────┐                                                    │
│  │Republish│  │  NACK  │  (Message discarded)                               │
│  │ +retry │   │(false) │                                                    │
│  │ header │   └────────┘                                                    │
│  └────────┘                                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```typescript
const MAX_RETRIES = 3;

const retries = msg.properties.headers?.["x-retries"] ?? 0;

try {
  await handler(data.payload);
  channel.ack(msg);
} catch (err) {
  if (retries < MAX_RETRIES - 1) {
    // Republish with incremented retry count
    channel.publish(exchange, routingKey, msg.content, {
      headers: { "x-retries": retries + 1 },
    });
    channel.ack(msg);  // Ack original
  } else {
    // Max retries reached - discard
    channel.nack(msg, false, false);
  }
}
```

---

## Priority Levels

```typescript
export const PRIORITY = {
  HIGH: 9,    // Payments, critical operations
  MEDIUM: 5,  // Normal operations
  LOW: 1,     // Background tasks
};
```

### Usage

```typescript
await publishMessage({
  eventType: "PAYMENT_CALLBACK",
  priority: PRIORITY.HIGH,  // Payments are high priority
  payload: { ... }
});
```

---

## Queue Metrics

```typescript
// Location: events/consumers/streaming.consumer.ts

export const getQueueMetrics = () => ({
  video: {
    activeJobs: 2,
    prefetch: 2,
    queueName: "video_processing_queue"
  },
  general: {
    processedCount: 15420,
    prefetch: 200,
    queueName: "general_queue"
  }
});
```

---

## File Structure

```
events/
├── producers/
│   └── streaming.publisher.ts       # Publish messages
│
└── consumers/
    ├── streaming.consumer.ts        # Start all consumers
    ├── video.consumer.ts            # VIDEO queue consumer
    ├── general.consumer.ts          # GENERAL queue consumer
    │
    └── eventHandlers/
        ├── video_handlers/
        │   ├── video_process.ts
        │   ├── video_thumbnail.ts
        │   └── video_delete.ts
        │
        ├── channel_handlers/
        │   ├── channel_created.ts
        │   ├── channel_updated.ts
        │   └── channel_deleted.ts
        │
        ├── subscription_handlers/
        │   ├── subscribe_channel.ts
        │   ├── subscribe_cancel.ts
        │   └── ...
        │
        ├── notification_handlers/
        │   ├── notification_read.ts
        │   └── ...
        │
        └── payment_handlers/
            ├── payment_initiated.ts
            └── payment_callback.ts
```

---

## Why Bulkhead Pattern?

### Problem Without Bulkhead

```
┌────────────────────────────────────────────────────────────────┐
│  SINGLE QUEUE (Bad)                                            │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Video │ Video │ Notif │ Video │ Payment │ Video │ ...   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  Problem: Video processing takes 5-10 minutes each             │
│  Result: Notifications and payments get delayed                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Solution With Bulkhead

```
┌────────────────────────────────────────────────────────────────┐
│  SEPARATE QUEUES (Good)                                        │
│                                                                │
│  VIDEO QUEUE (slow, limited workers)                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Video │ Video │  (2 workers max)                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  GENERAL QUEUE (fast, many workers)                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Notif │ Payment │ Sub │ Notif │ ...  (200 workers)      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
│  Result: Fast operations never wait for slow ones              │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```
