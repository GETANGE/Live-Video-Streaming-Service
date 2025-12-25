# Infrastructure Documentation

## Overview

The system uses a containerized microservices architecture with Nginx load balancing, circuit breakers for fault tolerance, and load shedding for resilience under pressure.

---

## Architecture

```
                              INFRASTRUCTURE ARCHITECTURE

                        Internet
                            |
                            v
                    +---------------+
                    |     Nginx     |
                    | Load Balancer |
                    +-------+-------+
                            |
          +-----------------+-----------------+
          |                 |                 |
          v                 v                 v
    +----------+      +----------+      +----------+
    |   App1   |      |   App2   |      |   App3   |
    | (Node.js)|      | (Node.js)|      | (Node.js)|
    +----+-----+      +----+-----+      +----+-----+
          |                 |                 |
          +-----------------+-----------------+
                            |
    +-----------------------+-----------------------+
    |           |           |           |           |
    v           v           v           v           v
+-------+  +--------+  +--------+  +-------+  +----------+
| Redis |  |Postgres|  |RabbitMQ|  | MinIO |  |Cloudinary|
+-------+  +--------+  +--------+  +-------+  | (External)|
                                              +----------+
```

---

## Docker Compose Services

### Application Instances (Load Balanced)

```yaml
# 3 identical app instances for high availability
app1, app2, app3:
  build: .
  environment:
    - INSTANCE_ID=app1|app2|app3
  depends_on:
    - redis (healthy)
    - postgres (healthy)
    - rabbitmq (healthy)
    - minio (healthy)
  volumes:
    - video_temp:/tmp/video-processing  # Shared temp storage
  healthcheck:
    test: curl -f http://localhost:3000/health
    interval: 10s
    retries: 5
```

### Infrastructure Services

| Service | Port | Purpose |
|---------|------|---------|
| Nginx | 80 | Load balancer, rate limiting, caching |
| Redis | 6379 (internal), 6380 (external) | Session, cache, pub/sub |
| PostgreSQL | 5432 (internal), 5435 (external) | Primary database |
| RabbitMQ | 5672, 15672 | Message queue (AMQP + Management) |
| MinIO | 9000, 9001 | Object storage (S3-compatible) |

---

## Nginx Load Balancer

### Load Balancing Configuration

```nginx
# API requests - Least connections (distributes evenly)
upstream app_servers {
    least_conn;
    keepalive 32;

    server app1:3000 weight=1 max_fails=3 fail_timeout=30s;
    server app2:3000 weight=1 max_fails=3 fail_timeout=30s;
    server app3:3000 weight=1 max_fails=3 fail_timeout=30s;
}

# WebSocket - IP hash (sticky sessions required)
upstream socket_servers {
    ip_hash;  # Same client always connects to same server

    server app1:3000;
    server app2:3000;
    server app3:3000;
}
```

### Why Different Strategies?

```
API Requests (least_conn):
-------------------------------------------
Client A ──> Request 1 ──> App1 (2 connections)
Client B ──> Request 2 ──> App2 (1 connection)  <- Chosen (least)
Client C ──> Request 3 ──> App2 (2 connections)
Client D ──> Request 4 ──> App3 (1 connection)  <- Chosen (least)

Distributes load evenly across all instances


WebSocket (ip_hash):
-------------------------------------------
Client A ──> WS Connect ──> App1 (always)
Client A ──> WS Message ──> App1 (same server!)
Client A ──> WS Message ──> App1 (same server!)

Client IP hash ensures same client always goes to same server
Required for Socket.IO persistent connections
```

---

## Rate Limiting

### Rate Limit Zones

```nginx
# 100 requests/second per IP for API
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;

# 5 requests/second per IP for uploads
limit_req_zone $binary_remote_addr zone=upload_limit:10m rate=5r/s;

# Max 10 concurrent connections per IP
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;
```

### Rate Limits by Endpoint

| Endpoint | Rate Limit | Burst | Purpose |
|----------|-----------|-------|---------|
| `/api/*` | 100 req/s | 50 | General API protection |
| `/api/upload` | 5 req/s | 10 | Prevent upload abuse |
| `/api/payments/callback` | No limit | - | M-Pesa callbacks from Safaricom |

---

## HLS Caching

### Cache Configuration

```nginx
# Cache path for HLS content
proxy_cache_path /var/cache/nginx/hls levels=1:2
                 keys_zone=hls_cache:100m
                 max_size=10g
                 inactive=60m
                 use_temp_path=off;
```

### Caching Strategy

```
Cache Type        TTL        Reason
----------------------------------------------
.m3u8 (playlists) 2 seconds  Updates frequently with new segments
.ts (segments)    1 hour     Immutable once created

Caching Flow:

  Client ──> Nginx ──> Cache Hit? ──> Yes ──> Return cached
                           |
                           No
                           |
                           v
                      App Server ──> Cache & Return
```

---

## Circuit Breakers

### What is a Circuit Breaker?

```
Normal Operation (CLOSED):
--------------------------------------------
Request ──> External Service ──> Response ✓

Multiple Failures (OPEN):
--------------------------------------------
Request ──> Circuit Breaker ──> FAST FAIL ✗
                  |
                  |  (Service is down, don't waste time)
                  v
            Return error immediately

Recovery (HALF-OPEN):
--------------------------------------------
After timeout, allow ONE test request
   |
   |── Success ──> CLOSE circuit (resume normal)
   |
   └── Failure ──> OPEN circuit (keep waiting)
```

### Circuit Breaker States

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CIRCUIT BREAKER STATE MACHINE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                    Failure Threshold                                        │
│         ┌──────────────────────────────┐                                    │
│         │                              │                                    │
│         │                              v                                    │
│    ┌────┴─────┐                   ┌─────────┐                               │
│    │  CLOSED  │                   │  OPEN   │                               │
│    │ (Normal) │                   │ (Fail   │                               │
│    │          │                   │  Fast)  │                               │
│    └────▲─────┘                   └────┬────┘                               │
│         │                              │                                    │
│         │     Success                  │ Reset Timeout                      │
│         │         ┌────────────────────┘                                    │
│         │         │                                                         │
│         │         v                                                         │
│         │    ┌─────────┐                                                    │
│         └────┤HALF-OPEN│                                                    │
│    (Success) │ (Test)  │                                                    │
│              └────┬────┘                                                    │
│                   │                                                         │
│                   │ Failure                                                 │
│                   └──────────────> Back to OPEN                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Circuit Breaker Configuration

```typescript
// Location: utils/circuitBreaker.ts

const defaultConfig = {
  timeout: 10000,              // 10s before call is considered failed
  errorThresholdPercentage: 50, // Trip if 50% of requests fail
  resetTimeout: 30000,          // Try again after 30 seconds
  volumeThreshold: 5,           // Need at least 5 requests before tripping
};
```

### Circuit Breakers in Use

| Service | Operations | Timeout | Reset Timeout |
|---------|------------|---------|---------------|
| **Cloudinary** | ImageUpload | 30s | 60s |
| | VideoUpload | 120s | 60s |
| | Delete | 10s | 30s |
| **M-Pesa** | Auth | 15s | 30s |
| | STK Push | 30s | 60s |
| **MinIO** | Upload | 30s | 30s |
| | Delete | 10s | 30s |
| | Stream | 15s | 30s |
| | HLS Upload | 30s | 30s |
| | Thumbnail Upload | 15s | 30s |

---

## Load Shedding

### What is Load Shedding?

When the server is under heavy load, reject new requests to protect existing operations.

```
Normal Load:
-----------------------------------------
Request 1 ──> Process ──> Response ✓
Request 2 ──> Process ──> Response ✓
Request 3 ──> Process ──> Response ✓

High Load (Memory Threshold Exceeded):
-----------------------------------------
Request 1 ──> Process ──> Response ✓
Request 2 ──> Process ──> Response ✓
Request 3 ──> 503 Service Unavailable (Retry-After: 5s)
                 |
                 └── Shed load to protect running operations
```

### Implementation

```typescript
// Location: middleware/loadShedding.middleware.ts

// Configurable thresholds
const MAX_HEAP_MB = parseInt(process.env.MAX_HEAP_MB || "512", 10);
const MAX_RSS_MB = parseInt(process.env.MAX_RSS_MB || "1024", 10);

export const loadSheddingMiddleware = (req, res, next) => {
  // Always allow health/metrics endpoints
  if (EXCLUDED_PATHS.some(path => req.path.startsWith(path))) {
    return next();
  }

  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const rssMB = memUsage.rss / 1024 / 1024;

  // Shed load if memory thresholds exceeded
  if (heapUsedMB > MAX_HEAP_MB || rssMB > MAX_RSS_MB) {
    res.setHeader("Retry-After", "5");
    return res.status(503).json({
      error: "Service temporarily unavailable",
      retryAfter: 5,
    });
  }

  next();
};
```

### Memory Thresholds

| Threshold | Default | Description |
|-----------|---------|-------------|
| `MAX_HEAP_MB` | 512 MB | JavaScript heap limit |
| `MAX_RSS_MB` | 1024 MB | Total process memory limit |

---

## Health Checks

### Docker Health Checks

```yaml
# App instances
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
  interval: 10s
  timeout: 5s
  retries: 5

# Redis
healthcheck:
  test: ["CMD", "redis-cli", "ping"]

# PostgreSQL
healthcheck:
  test: ["CMD", "pg_isready", "-U", "streaming_user", "-d", "streaming_db"]

# RabbitMQ
healthcheck:
  test: ["CMD", "rabbitmq-diagnostics", "ping"]

# MinIO
healthcheck:
  test: ["CMD", "mc", "ready", "local"]
```

### HTTP Endpoints

| Endpoint | Purpose | Protected |
|----------|---------|-----------|
| `/health` | Simple liveness check | No (Nginx returns 200) |
| `/ready` | Readiness check | No |
| `/metrics` | Detailed system metrics | Should be internal only |

---

## Metrics Endpoint

The `/metrics` endpoint provides real-time system health:

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
  },
  "socket": {
    "connectedClients": 150
  },
  "queues": {
    "video": { "activeJobs": 2, "prefetch": 2 },
    "general": { "processedCount": 15420, "prefetch": 200 }
  },
  "circuitBreakers": {
    "cloudinary": {
      "imageUpload": { "state": "closed", "stats": {...} },
      "videoUpload": { "state": "closed", "stats": {...} }
    },
    "mpesa": {
      "auth": { "state": "closed", "stats": {...} },
      "stkPush": { "state": "closed", "stats": {...} }
    },
    "minio": {
      "upload": { "state": "closed", "stats": {...} },
      "stream": { "state": "closed", "stats": {...} }
    }
  }
}
```

---

## WebSocket Configuration

### Nginx WebSocket Proxy

```nginx
location /socket.io/ {
    proxy_pass http://socket_servers;
    proxy_http_version 1.1;

    # WebSocket upgrade headers
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Long-lived connection timeouts (7 days!)
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;

    # Disable buffering for real-time
    proxy_buffering off;
}
```

### Why IP Hash for WebSockets?

```
Without IP Hash:
-----------------------------------------
Client A ──> WS Connect ──> App1 (session stored here)
Client A ──> WS Message ──> App2 (no session! Error!)

With IP Hash:
-----------------------------------------
Client A ──> WS Connect ──> App1 (session stored here)
Client A ──> WS Message ──> App1 (same server, session found!)
```

---

## Security Headers

Nginx adds security headers to all responses:

```nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
```

| Header | Purpose |
|--------|---------|
| `X-Frame-Options` | Prevent clickjacking |
| `X-Content-Type-Options` | Prevent MIME type sniffing |
| `X-XSS-Protection` | Enable browser XSS filter |

---

## Network Topology

```
Docker Network: live-video-streaming-service (bridge)

┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  ┌────────────────┐                                                      │
│  │     Nginx      │◀───── Port 80 (external)                             │
│  └───────┬────────┘                                                      │
│          │                                                               │
│          │ Internal routing                                              │
│          │                                                               │
│  ┌───────┼─────────────────────────────────────┐                         │
│  │       ▼              ▼              ▼       │                         │
│  │   ┌───────┐      ┌───────┐      ┌───────┐   │                         │
│  │   │ App1  │      │ App2  │      │ App3  │   │ App Tier               │
│  │   │ :3000 │      │ :3000 │      │ :3000 │   │                         │
│  │   └───┬───┘      └───┬───┘      └───┬───┘   │                         │
│  └───────┼──────────────┼──────────────┼───────┘                         │
│          │              │              │                                 │
│  ┌───────┼──────────────┼──────────────┼───────┐                         │
│  │       ▼              ▼              ▼       │                         │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐  │                         │
│  │  │ Redis  │ │Postgres│ │RabbitMQ│ │MinIO │  │ Data Tier              │
│  │  │ :6379  │ │ :5432  │ │ :5672  │ │:9000 │  │                         │
│  │  └────────┘ └────────┘ └────────┘ └──────┘  │                         │
│  └─────────────────────────────────────────────┘                         │
│                                                                          │
│  External ports exposed for development:                                 │
│  - Redis: 6380                                                           │
│  - Postgres: 5435                                                        │
│  - RabbitMQ: 5673 (AMQP), 15673 (Management)                             │
│  - MinIO: 9000 (API), 9001 (Console)                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Volumes

| Volume | Purpose |
|--------|---------|
| `redis_data` | Redis persistence (AOF enabled) |
| `postgres_data` | PostgreSQL data |
| `rabbitmq_data` | RabbitMQ message persistence |
| `minio_data` | Object storage data |
| `video_temp` | Shared temp for video processing |
| `nginx_cache` | HLS segment cache |

---

## Startup Order

Docker Compose ensures proper startup order:

```
1. Redis ─────────────┐
2. PostgreSQL ────────┼──> Health checks pass
3. RabbitMQ ──────────┤
4. MinIO ─────────────┘
           │
           │ depends_on with condition: service_healthy
           │
           v
5. App1, App2, App3 ──> Start after all infrastructure healthy
           │
           │ depends_on
           │
           v
6. Nginx ─────────────> Start after apps are ready
```

---

## Environment Variables

### Memory Management

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_HEAP_MB` | 512 | Load shedding heap threshold |
| `MAX_RSS_MB` | 1024 | Load shedding RSS threshold |

### Service Configuration

| Variable | Description |
|----------|-------------|
| `INSTANCE_ID` | Unique ID for each app instance |
| `REDIS_URL` | Redis connection string |
| `DATABASE_URL` | PostgreSQL connection string |
| `RABBITMQ_URL` | RabbitMQ connection string |
| `MINIO_ENDPOINT` | MinIO server address |
| `MINIO_BUCKET` | MinIO bucket name |

---

## Graceful Shutdown

All services are configured with `restart: unless-stopped` to:
- Automatically restart on crash
- Stay stopped if manually stopped
- Restart on host reboot

---

## Scaling

### Horizontal Scaling (Add More Instances)

1. Add new app instance to `docker-compose.yml`
2. Add to Nginx upstream configuration
3. Restart Nginx

```yaml
# Example: Adding app4
app4:
  build: .
  environment:
    - INSTANCE_ID=app4
  # ... same config as other apps

# Update nginx.conf
upstream app_servers {
    server app1:3000;
    server app2:3000;
    server app3:3000;
    server app4:3000;  # New instance
}
```

### Vertical Scaling (More Resources)

Adjust container resource limits in docker-compose.yml:

```yaml
app1:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '1'
        memory: 1G
```
