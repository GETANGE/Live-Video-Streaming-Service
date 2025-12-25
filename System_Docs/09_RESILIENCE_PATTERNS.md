# Resilience Patterns Documentation

## Overview

The system implements three key resilience patterns to handle failures gracefully and maintain stability under load:

1. **Circuit Breakers** - Prevent cascade failures when external services are down
2. **Load Shedding** - Reject requests when system resources are exhausted
3. **Backpressure** - Control message consumption rate via RabbitMQ prefetch

---

## Circuit Breakers

### What is a Circuit Breaker?

A circuit breaker wraps calls to external services and monitors for failures. When failures exceed a threshold, it "trips" and fails fast without making actual calls, preventing:

- Wasted time waiting for timeouts
- Resource exhaustion from hanging connections
- Cascade failures across the system

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     WITHOUT CIRCUIT BREAKER                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Request 1 ──> External Service (DOWN) ──> Wait 30s ──> Timeout ──> Error  │
│  Request 2 ──> External Service (DOWN) ──> Wait 30s ──> Timeout ──> Error  │
│  Request 3 ──> External Service (DOWN) ──> Wait 30s ──> Timeout ──> Error  │
│  Request 4 ──> External Service (DOWN) ──> Wait 30s ──> Timeout ──> Error  │
│                                                                             │
│  Problem: Each request waits 30s, threads pile up, server overwhelmed      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      WITH CIRCUIT BREAKER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Request 1 ──> External Service (DOWN) ──> Wait 30s ──> Timeout ──> Error  │
│  Request 2 ──> External Service (DOWN) ──> Wait 30s ──> Timeout ──> Error  │
│  Request 3 ──> External Service (DOWN) ──> Wait 30s ──> Timeout ──> Error  │
│                                                                             │
│  ═══════════════════ CIRCUIT TRIPS (50% failures) ═══════════════════════  │
│                                                                             │
│  Request 4 ──> Circuit OPEN ──> INSTANT Error (no wait!)                   │
│  Request 5 ──> Circuit OPEN ──> INSTANT Error (no wait!)                   │
│  Request 6 ──> Circuit OPEN ──> INSTANT Error (no wait!)                   │
│                                                                             │
│  Benefit: Fail fast, free up resources, prevent cascade                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Circuit Breaker States

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CIRCUIT BREAKER STATE MACHINE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                                                                             │
│         ┌──────────────────────────────────────────────┐                    │
│         │                                              │                    │
│         │  Failure threshold exceeded (50%)            │                    │
│         │                                              │                    │
│         ▼                                              │                    │
│    ┌─────────┐         resetTimeout          ┌─────────┐                    │
│    │  OPEN   │ ─────────────────────────────▶│HALF-OPEN│                    │
│    │         │         (30-60s)              │         │                    │
│    │ Fail    │                               │  Test   │                    │
│    │ Fast!   │                               │  One    │                    │
│    └─────────┘                               │ Request │                    │
│         ▲                                    └────┬────┘                    │
│         │                                         │                         │
│         │                              ┌──────────┴──────────┐              │
│         │                              │                     │              │
│         │                           Success               Failure           │
│         │                              │                     │              │
│         │                              ▼                     │              │
│         │                        ┌──────────┐                │              │
│         │                        │  CLOSED  │                │              │
│         └────────────────────────│          │◀───────────────┘              │
│           (back to failing)      │  Normal  │   (stay open)                 │
│                                  │Operation │                               │
│                                  └──────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

STATES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CLOSED (Normal)
  - All requests pass through to external service
  - Failures are tracked
  - If failure rate > threshold → OPEN

OPEN (Fail Fast)
  - All requests rejected immediately with error
  - No calls to external service
  - After resetTimeout → HALF-OPEN

HALF-OPEN (Testing)
  - Allow ONE test request through
  - If success → CLOSED (recovered!)
  - If failure → OPEN (still down)
```

---

### Implementation

```typescript
// Location: utils/circuitBreaker.ts

import CircuitBreaker from "opossum";

interface CircuitBreakerConfig {
  name: string;
  timeout?: number;              // Time before call is considered failed
  errorThresholdPercentage?: number;  // Error % to trip circuit
  resetTimeout?: number;         // Time before trying again
  volumeThreshold?: number;      // Min requests before tripping
}

const defaultConfig = {
  timeout: 10000,              // 10 seconds
  errorThresholdPercentage: 50, // Trip if 50% of requests fail
  resetTimeout: 30000,          // Try again after 30 seconds
  volumeThreshold: 5,           // Need at least 5 requests before tripping
};

export const createCircuitBreaker = <T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: CircuitBreakerConfig,
): CircuitBreaker<any[], any> => {
  const options = {
    timeout: config.timeout ?? defaultConfig.timeout,
    errorThresholdPercentage: config.errorThresholdPercentage ?? defaultConfig.errorThresholdPercentage,
    resetTimeout: config.resetTimeout ?? defaultConfig.resetTimeout,
    volumeThreshold: config.volumeThreshold ?? defaultConfig.volumeThreshold,
  };

  const breaker = new CircuitBreaker(fn, options);

  // Logging events
  breaker.on("open", () => {
    logger.warn(`Circuit OPEN: ${config.name} - requests will fail fast`);
  });

  breaker.on("halfOpen", () => {
    logger.info(`Circuit HALF-OPEN: ${config.name} - testing if service recovered`);
  });

  breaker.on("close", () => {
    logger.info(`Circuit CLOSED: ${config.name} - service recovered`);
  });

  breaker.on("timeout", () => {
    logger.warn(`Circuit TIMEOUT: ${config.name} - request timed out`);
  });

  return breaker;
};
```

---

### Circuit Breakers in the System

#### 1. Cloudinary (CDN)

```typescript
// Location: services/cdn.service.ts

// Image uploads - 30s timeout, 1 min reset
const imageUploadBreaker = createCircuitBreaker(_uploadImage, {
  name: "Cloudinary:ImageUpload",
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 60000,
  volumeThreshold: 3,
});

// Video uploads - 2 min timeout (videos are large)
const videoUploadBreaker = createCircuitBreaker(_uploadVideo, {
  name: "Cloudinary:VideoUpload",
  timeout: 120000,
  errorThresholdPercentage: 50,
  resetTimeout: 60000,
  volumeThreshold: 3,
});

// Delete operations - 10s timeout
const deleteBreaker = createCircuitBreaker(_deleteFromCDN, {
  name: "Cloudinary:Delete",
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

// Usage
export const uploadImage = async (buffer, folder, publicId) => {
  return imageUploadBreaker.fire(buffer, folder, publicId);
};
```

#### 2. M-Pesa (Payment Gateway)

```typescript
// Location: api/mpesa.api.ts

// Auth token - 15s timeout
const authBreaker = createCircuitBreaker(_getAuthAccessToken, {
  name: "MPesa:Auth",
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 3,
});

// STK Push - 30s timeout, 1 min reset (M-Pesa can be slow)
const stkPushBreaker = createCircuitBreaker(_sendSTKPUSH_request, {
  name: "MPesa:STKPush",
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 60000,
  volumeThreshold: 3,
});

// Usage
export const getAuthAccessToken = async (): Promise<string> => {
  return authBreaker.fire();
};

export const sendSTKPUSH_request = async (requestBody, token) => {
  return stkPushBreaker.fire(requestBody, token);
};
```

#### 3. MinIO (Object Storage)

```typescript
// Location: helpers/hls.helper-functions.ts

// File upload - 30s timeout
const uploadBreaker = createCircuitBreaker(_uploadToMinio, {
  name: "MinIO:Upload",
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

// File streaming - 15s timeout
const streamBreaker = createCircuitBreaker(_streamFromMinio, {
  name: "MinIO:Stream",
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

// HLS segment upload - 30s timeout
const hlsUploadBreaker = createCircuitBreaker(_uploadHLSFile, {
  name: "MinIO:HLSUpload",
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

// Thumbnail upload - 15s timeout
const thumbnailUploadBreaker = createCircuitBreaker(_uploadThumbnail, {
  name: "MinIO:ThumbnailUpload",
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});

// Delete operation - 10s timeout
const deleteBreaker = createCircuitBreaker(_deleteFromMinio, {
  name: "MinIO:Delete",
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
});
```

---

### Configuration Summary

| Service | Operation | Timeout | Reset Timeout | Volume Threshold |
|---------|-----------|---------|---------------|------------------|
| **Cloudinary** | Image Upload | 30s | 60s | 3 |
| | Video Upload | 120s | 60s | 3 |
| | Delete | 10s | 30s | 5 |
| **M-Pesa** | Auth | 15s | 30s | 3 |
| | STK Push | 30s | 60s | 3 |
| **MinIO** | Upload | 30s | 30s | 5 |
| | Stream | 15s | 30s | 5 |
| | HLS Upload | 30s | 30s | 5 |
| | Thumbnail | 15s | 30s | 5 |
| | Delete | 10s | 30s | 5 |

---

### Monitoring Circuit Breakers

```typescript
// Get stats for monitoring
export const getCircuitStats = (breaker: CircuitBreaker<any, any>) => ({
  state: breaker.opened ? "open" : breaker.halfOpen ? "half-open" : "closed",
  stats: {
    successes: breaker.stats.successes,
    failures: breaker.stats.failures,
    timeouts: breaker.stats.timeouts,
    fallbacks: breaker.stats.fallbacks,
    rejects: breaker.stats.rejects,
  },
});

// Exposed via /metrics endpoint
app.get("/metrics", (req, res) => {
  res.json({
    circuitBreakers: {
      cloudinary: getCDNCircuitStats(),
      mpesa: getMpesaCircuitStats(),
      minio: getMinioCircuitStats(),
    },
  });
});
```

**Example /metrics response:**

```json
{
  "circuitBreakers": {
    "cloudinary": {
      "imageUpload": {
        "state": "closed",
        "stats": { "successes": 150, "failures": 2, "timeouts": 1, "rejects": 0 }
      },
      "videoUpload": {
        "state": "closed",
        "stats": { "successes": 45, "failures": 0, "timeouts": 0, "rejects": 0 }
      }
    },
    "mpesa": {
      "auth": {
        "state": "closed",
        "stats": { "successes": 200, "failures": 5, "timeouts": 3, "rejects": 0 }
      },
      "stkPush": {
        "state": "open",
        "stats": { "successes": 180, "failures": 15, "timeouts": 10, "rejects": 50 }
      }
    },
    "minio": {
      "upload": { "state": "closed", "stats": { "successes": 500, "failures": 1 } },
      "stream": { "state": "closed", "stats": { "successes": 1200, "failures": 0 } }
    }
  }
}
```

---

## Load Shedding

### What is Load Shedding?

Load shedding is a protective mechanism that rejects incoming requests when the server is under excessive load, preventing complete system failure.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      WITHOUT LOAD SHEDDING                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Memory: 400MB ──> 500MB ──> 600MB ──> 800MB ──> 1GB ──> 💥 CRASH!         │
│                                                                             │
│  As more requests come in:                                                  │
│  - Memory keeps growing                                                     │
│  - Response times increase                                                  │
│  - Eventually server crashes                                                │
│  - ALL users affected                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                       WITH LOAD SHEDDING                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Memory: 400MB ──> 500MB ──> 512MB (threshold!)                             │
│                                 │                                           │
│                                 ▼                                           │
│                    ┌─────────────────────────────┐                          │
│                    │   LOAD SHEDDING ACTIVE      │                          │
│                    │   New requests: 503 Error   │                          │
│                    │   Existing: Continue OK     │                          │
│                    └─────────────────────────────┘                          │
│                                 │                                           │
│  Memory: 512MB ──> 480MB ──> 400MB (recovered)                              │
│                                 │                                           │
│                                 ▼                                           │
│                    ┌─────────────────────────────┐                          │
│                    │   LOAD SHEDDING OFF         │                          │
│                    │   Accept new requests       │                          │
│                    └─────────────────────────────┘                          │
│                                                                             │
│  Result: Server stays healthy, existing users unaffected                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Implementation

```typescript
// Location: middleware/loadShedding.middleware.ts

import { Request, Response, NextFunction } from "express";

// Endpoints that are NEVER shed (always allowed)
const EXCLUDED_PATHS = ["/health", "/metrics", "/ready"];

// Configurable thresholds (in MB)
const MAX_HEAP_MB = parseInt(process.env.MAX_HEAP_MB || "512", 10);
const MAX_RSS_MB = parseInt(process.env.MAX_RSS_MB || "1024", 10);

export const loadSheddingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Always allow health checks and metrics
  if (EXCLUDED_PATHS.some((path) => req.path.startsWith(path))) {
    return next();
  }

  // Check current memory usage
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const rssMB = memUsage.rss / 1024 / 1024;

  // Shed load if thresholds exceeded
  if (heapUsedMB > MAX_HEAP_MB || rssMB > MAX_RSS_MB) {
    res.setHeader("Retry-After", "5");  // Tell client to retry in 5s
    return res.status(503).json({
      error: "Service temporarily unavailable",
      retryAfter: 5,
    });
  }

  next();
};
```

---

### Memory Thresholds

| Threshold | Environment Variable | Default | Description |
|-----------|---------------------|---------|-------------|
| Heap Used | `MAX_HEAP_MB` | 512 MB | JavaScript heap memory limit |
| RSS | `MAX_RSS_MB` | 1024 MB | Total process memory limit |

**Heap vs RSS:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MEMORY TYPES                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RSS (Resident Set Size)                                                    │
│  ├── Total memory allocated to the process                                  │
│  ├── Includes:                                                              │
│  │   ├── Heap (JavaScript objects)                                          │
│  │   ├── Code segment                                                       │
│  │   ├── Stack                                                              │
│  │   └── Shared libraries                                                   │
│  └── If this is high, the whole process is using too much                   │
│                                                                             │
│  Heap Used                                                                  │
│  ├── Memory used by JavaScript objects                                      │
│  ├── Where your data lives (arrays, objects, buffers)                       │
│  └── If this is high, you may have a memory leak                            │
│                                                                             │
│  Example:                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  RSS: 800 MB                                                         │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │  Heap Used: 400 MB                                             │  │   │
│  │  │  (JavaScript objects, buffers, video data)                     │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  │  + Code: 100 MB                                                      │   │
│  │  + Native modules: 200 MB                                            │   │
│  │  + Stack + Other: 100 MB                                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Excluded Paths

These paths are NEVER shed, ensuring monitoring and health checks always work:

| Path | Reason |
|------|--------|
| `/health` | Kubernetes/Docker liveness probe |
| `/metrics` | Monitoring and alerting |
| `/ready` | Kubernetes readiness probe |

---

### Client Handling

When load shedding is active, clients receive:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 5
Content-Type: application/json

{
  "error": "Service temporarily unavailable",
  "retryAfter": 5
}
```

**Client-side handling:**

```javascript
async function makeRequest(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.status === 503) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "5");
      console.log(`Server overloaded, retrying in ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      continue;
    }

    return response;
  }
  throw new Error("Max retries exceeded");
}
```

---

### Metrics Endpoint

The `/metrics` endpoint provides real-time load shedding status:

```typescript
// Location: middleware/loadShedding.middleware.ts

export const metricsHandler = (_req: Request, res: Response) => {
  const memUsage = process.memoryUsage();

  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB",
      thresholds: {
        maxHeap: MAX_HEAP_MB + "MB",
        maxRss: MAX_RSS_MB + "MB",
      },
    },
    // ... other metrics
  });
};
```

**Example response:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "memory": {
    "heapUsed": "256MB",
    "heapTotal": "512MB",
    "rss": "384MB",
    "thresholds": {
      "maxHeap": "512MB",
      "maxRss": "1024MB"
    }
  }
}
```

---

## Backpressure

### What is Backpressure?

Backpressure is a mechanism to control the rate at which messages are consumed from a queue. It prevents consumers from being overwhelmed by limiting how many unacknowledged messages they can hold at once.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      WITHOUT BACKPRESSURE (prefetch = unlimited)            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RabbitMQ Queue: [msg1][msg2][msg3][msg4][msg5][msg6][msg7][msg8]...       │
│                      │                                                      │
│                      │  ALL messages delivered at once                      │
│                      ▼                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Consumer                                                            │   │
│  │  ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐           │   │
│  │  │msg1 ││msg2 ││msg3 ││msg4 ││msg5 ││msg6 ││msg7 ││msg8 │  ...      │   │
│  │  └─────┘└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘           │   │
│  │                                                                      │   │
│  │  Problem: Consumer overwhelmed, memory explodes, crashes!            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                       WITH BACKPRESSURE (prefetch = 2)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RabbitMQ Queue: [msg1][msg2][msg3][msg4][msg5][msg6][msg7][msg8]...       │
│                      │    │                                                 │
│                      │    │  Only 2 messages at a time                      │
│                      ▼    ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Consumer (prefetch = 2)                                             │   │
│  │  ┌─────┐┌─────┐                                                      │   │
│  │  │msg1 ││msg2 │  ← Only 2 unacknowledged messages allowed            │   │
│  │  └──┬──┘└─────┘                                                      │   │
│  │     │                                                                │   │
│  │     │ Process & ACK                                                  │   │
│  │     ▼                                                                │   │
│  │  ┌─────┐┌─────┐                                                      │   │
│  │  │msg2 ││msg3 │  ← msg3 delivered only after msg1 is ACKed          │   │
│  │  └─────┘└─────┘                                                      │   │
│  │                                                                      │   │
│  │  Benefit: Controlled memory usage, predictable processing           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Bulkhead Pattern with Separate Queues

The system uses the **Bulkhead Pattern** - separating heavy operations from lightweight operations into different queues with different prefetch values.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BULKHEAD PATTERN                                  │
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
│  ┌─────────────────▼─────────────────┐  ┌─────────▼─────────────────────┐   │
│  │         VIDEO QUEUE               │  │       GENERAL QUEUE           │   │
│  │                                   │  │                               │   │
│  │   Prefetch: 2 (only 2 at once)    │  │   Prefetch: 200 (fast!)       │   │
│  │                                   │  │                               │   │
│  │   Events:                         │  │   Events:                     │   │
│  │   • VIDEO_PROCESS (5-10 min)      │  │   • SUBSCRIPTION_CREATED      │   │
│  │   • VIDEO_THUMBNAIL               │  │   • NOTIFICATION_MARK_READ    │   │
│  │   • VIDEO_DELETE                  │  │   • PAYMENT_INITIATED         │   │
│  │   • CHANNEL_DELETED               │  │   • CHANNEL_CREATED/UPDATED   │   │
│  │                                   │  │   • USER_PROFILE_UPDATE       │   │
│  │   Heavy CPU/IO operations         │  │   • ... (all lightweight)     │   │
│  └─────────────────┬─────────────────┘  └─────────────┬─────────────────┘   │
│                    │                                   │                    │
│                    ▼                                   ▼                    │
│            ┌───────────────┐                  ┌────────────────┐            │
│            │Video Consumer │                  │General Consumer│            │
│            │ (Dedicated    │                  │ (Dedicated     │            │
│            │  Channel)     │                  │  Channel)      │            │
│            └───────────────┘                  └────────────────┘            │
│                                                                             │
│  Why? Video processing blocks for 5-10 minutes. Without separation,        │
│       a few video jobs would block ALL notifications and payments!         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Queue Configuration

```typescript
// Location: constants/constant.ts

export const QUEUES = {
  VIDEO: {
    name: "video_processing_queue",
    routingKey: "video.process",
    prefetch: 2,          // Only 2 concurrent video jobs
    maxPriority: 10,
  },
  GENERAL: {
    name: "general_queue",
    routingKey: "general.events",
    prefetch: 200,        // 200 concurrent lightweight jobs
    maxPriority: 10,
  },
} as const;

// Events routed to VIDEO queue (heavy operations)
export const VIDEO_EVENTS = [
  "VIDEO_PROCESS",       // Transcode video to HLS (5-10 min)
  "VIDEO_TRANSCODE",
  "VIDEO_THUMBNAIL",
  "VIDEO_DELETE",        // Delete from MinIO/CDN
  "CHANNEL_DELETED",     // Delete all channel videos
] as const;
```

---

### Dedicated Channels with Prefetch

Each queue gets a dedicated AMQP channel with its own prefetch setting:

```typescript
// Location: configs/rabbitMQ.config.ts

// Get a dedicated channel for VIDEO processing (low prefetch)
export const getVideoChannel = async (): Promise<any> => {
  if (!connection) {
    await getRabbitMQChannel();
  }

  const videoChannel = await connection.createChannel();
  await videoChannel.prefetch(QUEUES.VIDEO.prefetch);  // prefetch = 2

  return videoChannel;
};

// Get a dedicated channel for GENERAL processing (high prefetch)
export const getGeneralChannel = async (): Promise<any> => {
  if (!connection) {
    await getRabbitMQChannel();
  }

  const generalChannel = await connection.createChannel();
  await generalChannel.prefetch(QUEUES.GENERAL.prefetch);  // prefetch = 200

  return generalChannel;
};
```

---

### Consumer Implementation

```typescript
// Location: events/consumers/video.consumer.ts

let activeJobs = 0;

export const consumeVideoQueue = async () => {
  const channel = await getVideoChannel();

  logger.info(`Video consumer started (prefetch: ${QUEUES.VIDEO.prefetch})`);

  channel.consume(
    QUEUES.VIDEO.name,
    async (msg: any) => {
      if (!msg) return;

      const data = JSON.parse(msg.content.toString());
      const handler = videoEventHandlers[data.eventType];

      activeJobs++;  // Track for metrics

      try {
        logger.info(`[VIDEO] Processing: ${data.eventType} (active: ${activeJobs})`);
        await handler(data.payload);
        channel.ack(msg);  // ACK releases slot for next message
        logger.info(`[VIDEO] Completed: ${data.eventType}`);
      } catch (err) {
        // Retry logic...
      } finally {
        activeJobs--;
      }
    },
    { noAck: false },  // Manual ACK required for backpressure to work
  );
};
```

---

### Why Different Prefetch Values?

```
VIDEO QUEUE (prefetch = 2):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Processing Time: 5-10 minutes per video
Resources: High CPU (FFmpeg), High Memory (video buffers), High I/O

  ┌─────────────────────────────────────────────────────────────────────┐
  │  With prefetch = 2:                                                 │
  │                                                                     │
  │  Time 0:   [Video1 Processing] [Video2 Processing]                  │
  │  Time 5m:  [Video1 Done✓] [Video2 Processing] [Video3 starts]       │
  │  Time 10m: [Video2 Done✓] [Video3 Processing] [Video4 starts]       │
  │                                                                     │
  │  CPU: ~80% (2 FFmpeg processes)                                     │
  │  Memory: Predictable (~2GB for 2 videos)                            │
  │  Queue: Messages wait safely in RabbitMQ                            │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  With prefetch = 100 (BAD!):                                        │
  │                                                                     │
  │  Time 0:   100 videos start processing simultaneously!              │
  │                                                                     │
  │  CPU: 100% (100 FFmpeg processes fighting for CPU)                  │
  │  Memory: CRASH! (100GB needed)                                      │
  │  Result: Server dies, all videos fail                               │
  └─────────────────────────────────────────────────────────────────────┘


GENERAL QUEUE (prefetch = 200):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Processing Time: 10-100 milliseconds per message
Resources: Low CPU, Low Memory (just DB queries)

  ┌─────────────────────────────────────────────────────────────────────┐
  │  With prefetch = 200:                                               │
  │                                                                     │
  │  Time 0:    [N1][N2][N3]...[N200] - 200 notifications in flight     │
  │  Time 50ms: [N1✓][N2✓][N3✓]... - Many completed, new ones pulled    │
  │  Time 100ms: Processing thousands per second                        │
  │                                                                     │
  │  Why high prefetch?                                                 │
  │  • Each job is tiny (just a DB write)                               │
  │  • Network round-trip to RabbitMQ is expensive                      │
  │  • Batching reduces overhead dramatically                           │
  │                                                                     │
  │  Throughput: ~5000-10000 messages/second                            │
  └─────────────────────────────────────────────────────────────────────┘
```

---

### Backpressure Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKPRESSURE IN ACTION                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Consumer starts with prefetch = 2                                       │
│                                                                             │
│     RabbitMQ: [V1][V2][V3][V4][V5]...                                       │
│                 │   │                                                       │
│                 ▼   ▼                                                       │
│     Consumer:  [V1][V2]  ← Only 2 delivered                                 │
│                                                                             │
│  2. Consumer processes V1 (takes 5 minutes)                                 │
│                                                                             │
│     RabbitMQ: [V3][V4][V5]...  (V1, V2 still unacked)                       │
│     Consumer: [V1 processing...][V2 waiting]                                │
│                                                                             │
│  3. V1 completes, ACK sent                                                  │
│                                                                             │
│     Consumer: channel.ack(V1)                                               │
│                     │                                                       │
│                     ▼                                                       │
│     RabbitMQ receives ACK                                                   │
│                     │                                                       │
│                     ▼                                                       │
│     RabbitMQ: [V4][V5]...                                                   │
│                 │                                                           │
│                 ▼                                                           │
│     Consumer: [V2 processing][V3 delivered]  ← V3 now delivered             │
│                                                                             │
│  4. Cycle continues...                                                      │
│                                                                             │
│     Always exactly 2 messages in-flight                                     │
│     Memory usage: Predictable and stable                                    │
│     Queue: Safely stores backlog in RabbitMQ                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Queue Metrics

Monitor backpressure via the `/metrics` endpoint:

```typescript
// Location: events/consumers/video.consumer.ts

export const getVideoQueueMetrics = () => ({
  activeJobs,                    // Currently processing
  prefetch: QUEUES.VIDEO.prefetch,  // Max concurrent
  queueName: QUEUES.VIDEO.name,
});

// Location: events/consumers/general.consumer.ts

export const getGeneralQueueMetrics = () => ({
  processedCount,                   // Total processed
  prefetch: QUEUES.GENERAL.prefetch,
  queueName: QUEUES.GENERAL.name,
});
```

**Example /metrics response:**

```json
{
  "queues": {
    "video": {
      "activeJobs": 2,
      "prefetch": 2,
      "queueName": "video_processing_queue"
    },
    "general": {
      "processedCount": 15420,
      "prefetch": 200,
      "queueName": "general_queue"
    }
  }
}
```

---

### Prefetch Tuning Guidelines

| Queue Type | Prefetch | Reasoning |
|------------|----------|-----------|
| **CPU-Intensive** (video, image processing) | 1-4 | Limited by CPU cores |
| **I/O-Bound** (file uploads, API calls) | 10-50 | Can parallelize I/O |
| **Fast DB Operations** | 100-500 | Network latency matters more |
| **Fire-and-Forget** (logging, analytics) | 500-1000 | Maximize throughput |

---

### Retry with Backpressure

Failed messages are requeued without breaking backpressure:

```typescript
// On failure, republish with retry count
if (retries < MAX_RETRIES - 1) {
  const mainChannel = await getRabbitMQChannel();
  mainChannel.publish(
    RabbitMQConfig.exchangeName,
    QUEUES.VIDEO.routingKey,
    msg.content,
    {
      persistent: true,
      headers: { "x-retries": retries + 1 },
      priority: msg.properties.priority,
    },
  );
  channel.ack(msg);  // ACK original to free prefetch slot
} else {
  channel.nack(msg, false, false);  // Discard after max retries
}
```

---

## Combined Resilience Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    REQUEST LIFECYCLE WITH RESILIENCE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Incoming Request                                                           │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────┐                                                │
│  │   Load Shedding Check   │                                                │
│  │   (Memory thresholds)   │                                                │
│  └───────────┬─────────────┘                                                │
│              │                                                              │
│      ┌───────┴───────┐                                                      │
│      │               │                                                      │
│   Memory OK      Memory HIGH                                                │
│      │               │                                                      │
│      ▼               ▼                                                      │
│   Continue      503 Service                                                 │
│      │          Unavailable                                                 │
│      │               │                                                      │
│      ▼               └────────────────────────────────────────────────────▶ │
│  ┌─────────────────────────┐                                                │
│  │   Nginx Rate Limiting   │                                                │
│  │   (100 req/s API)       │                                                │
│  └───────────┬─────────────┘                                                │
│              │                                                              │
│      ┌───────┴───────┐                                                      │
│      │               │                                                      │
│   Within Limit   Over Limit                                                 │
│      │               │                                                      │
│      ▼               ▼                                                      │
│   Continue       429 Too                                                    │
│      │           Many Requests                                              │
│      │               │                                                      │
│      ▼               └────────────────────────────────────────────────────▶ │
│  ┌─────────────────────────┐                                                │
│  │   Application Logic     │                                                │
│  │   (Your code runs)      │                                                │
│  └───────────┬─────────────┘                                                │
│              │                                                              │
│              ▼                                                              │
│  ┌─────────────────────────┐                                                │
│  │  External Service Call  │                                                │
│  │  (Cloudinary/M-Pesa/    │                                                │
│  │   MinIO)                │                                                │
│  └───────────┬─────────────┘                                                │
│              │                                                              │
│              ▼                                                              │
│  ┌─────────────────────────┐                                                │
│  │   Circuit Breaker       │                                                │
│  └───────────┬─────────────┘                                                │
│              │                                                              │
│      ┌───────┴───────┐                                                      │
│      │               │                                                      │
│   CLOSED          OPEN                                                      │
│      │               │                                                      │
│      ▼               ▼                                                      │
│   Make Call      Fail Fast                                                  │
│      │           (Error)                                                    │
│      │               │                                                      │
│      ▼               └────────────────────────────────────────────────────▶ │
│   Success/Failure                                                           │
│      │                                                                      │
│      ▼                                                                      │
│   Response                                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Best Practices

### Circuit Breakers

1. **Set appropriate timeouts** - Match the expected response time of the service
2. **Tune volume threshold** - Don't trip on isolated failures (set to 3-5)
3. **Log state changes** - Monitor when circuits open/close
4. **Provide fallbacks** - Return cached data or graceful degradation

### Load Shedding

1. **Always exclude health endpoints** - Monitoring must work
2. **Set thresholds conservatively** - Better to shed early than crash
3. **Include Retry-After header** - Help clients backoff properly
4. **Monitor shedding frequency** - High frequency = need more capacity

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_HEAP_MB` | 512 | Load shedding heap threshold |
| `MAX_RSS_MB` | 1024 | Load shedding RSS threshold |

---

## Alerts to Set Up

| Metric | Threshold | Action |
|--------|-----------|--------|
| Circuit breaker opens | Any | Investigate external service |
| Load shedding triggered | > 10/min | Scale up or investigate leak |
| Memory > 80% threshold | Heap > 400MB | Warning - approaching limit |
| Circuit breaker rejects | > 100/min | External service down |
