# Caching System Documentation

## Overview

The system uses Redis for caching with a **version-based invalidation pattern**. This allows instant cache invalidation without scanning for keys.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CACHING ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐       ┌──────────┐       ┌──────────┐                         │
│  │  Client  │──────▶│  Server  │──────▶│  Redis   │                         │
│  └──────────┘       └────┬─────┘       └──────────┘                         │
│                          │                   │                              │
│                          │   Cache Miss      │                              │
│                          │◀──────────────────┘                              │
│                          │                                                  │
│                          ▼                                                  │
│                    ┌──────────┐                                             │
│                    │ Database │                                             │
│                    │(Postgres)│                                             │
│                    └──────────┘                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Version-Based Invalidation Pattern

### The Problem with Traditional Invalidation

```
Traditional Approach:
─────────────────────────────────────────────────────────
When channel is updated:
1. Find all keys: channel:123, channel:123:stats, channel:123:videos, ...
2. Delete each key individually
3. Problem: Need to know ALL keys, slow with many keys
```

### Solution: Version-Based Keys

```
Version-Based Approach:
─────────────────────────────────────────────────────────
Keys include version number:
  channel:version:id:123:v1
  channel:version:stats:123:v1
  channel:version:trending:v1

When channel is updated:
1. Increment version: v1 → v2
2. Done! Old keys are now orphaned

New requests use v2:
  channel:version:id:123:v2  ← Cache miss, fresh data

Old v1 keys expire naturally via TTL
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      VERSION-BASED CACHE FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Redis State:                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │  channel:version = "5"                                          │        │
│  │  channel:version:id:abc:5 = {name: "Gaming", ...}               │        │
│  │  channel:version:stats:abc:5 = {subscribers: 100}               │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
│                              │                                              │
│                              │ Channel Updated                              │
│                              ▼                                              │
│                                                                             │
│  invalidateChannelCache():                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │  INCR channel:version  →  "5" becomes "6"                       │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
│                              │                                              │
│                              │ Next Request                                 │
│                              ▼                                              │
│                                                                             │
│  getChannelCacheKeys():                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │  version = GET channel:version  →  "6"                          │        │
│  │  cacheKey = channel:version:id:abc:6  ← Different key!          │        │
│  │                                                                 │        │
│  │  GET channel:version:id:abc:6  →  null (cache miss)             │        │
│  │  → Fetch from DB, cache with new key                            │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
│  Old keys (v5) expire naturally after TTL                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### Cache Helper Structure

```typescript
// Location: helpers/cacheInvalidations/channelCacheInvalidation.ts

import redisClient from "@configs/redis.config";

const CHANNEL_VERSION_KEY = "channel:version";

const channelKey = (version: string, key: string) =>
  `${CHANNEL_VERSION_KEY}:${key}:${version}`;

const getChannelVersion = async () => {
  let version = await redisClient.get(CHANNEL_VERSION_KEY);
  if (!version) {
    version = "1";
    await redisClient.set(CHANNEL_VERSION_KEY, version);
  }
  return version;
};

export const getChannelCacheKeys = async () => {
  const version = await getChannelVersion();

  return {
    byId: (id: string) => channelKey(version, `id:${id}`),
    byName: (name: string) => channelKey(version, `name:${name}`),
    byOwner: (ownerId: string) => channelKey(version, `owner:${ownerId}`),
    stats: (channelId: string) => channelKey(version, `stats:${channelId}`),
    trending: () => channelKey(version, `trending`),
  };
};

export const invalidateChannelCache = async () => {
  await redisClient.incr(CHANNEL_VERSION_KEY);
  logger.info("Channel cache invalidated");
};
```

---

## Cache Keys by Domain

### Channel Cache

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `channel:version` | Current version number | None |
| `channel:version:id:{id}:{v}` | Channel by ID | 5 min |
| `channel:version:name:{name}:{v}` | Channel by name | 5 min |
| `channel:version:owner:{id}:{v}` | Channel by owner | 5 min |
| `channel:version:stats:{id}:{v}` | Channel stats | 5 min |
| `channel:version:trending:{v}` | Trending channels | 10 min |

### Subscription Cache

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `subscription:version` | Current version number | None |
| `subscription:version:id:{id}:{v}` | Subscription by ID | 5 min |
| `subscription:version:user:{id}:{v}` | User subscriptions | 5 min |
| `channel:{id}:subscriber_count` | Subscriber count | 1 min |
| `user:{id}:subscribed:{channelId}` | Is user subscribed | 5 min |

### Pending Subscriptions (Payment)

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `pending_subscription:{checkoutId}` | Pending payment | 1 hour |

---

## Usage in Repository

```typescript
// Location: repository/channel.repository.ts

export const getChannelById = async (id: string) => {
  // 1. Get versioned cache key
  const cacheKeys = await getChannelCacheKeys();
  const cacheKey = cacheKeys.byId(id);

  // 2. Check cache
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // 3. Cache miss - fetch from DB
  const channel = await prisma.channel.findUnique({
    where: { id },
    include: { owner: true, _count: { select: { subscriptions: true } } },
  });

  // 4. Cache the result
  if (channel) {
    await redisClient.setex(cacheKey, CACHE_TTL, JSON.stringify(channel));
  }

  return channel;
};

export const updateChannel = async (id: string, data: any) => {
  const channel = await prisma.channel.update({ where: { id }, data });

  // Invalidate ALL channel cache (version increment)
  await invalidateChannelCache();

  return channel;
};
```

---

## Cache Invalidation Triggers

### Channel Cache

| Action | Invalidation |
|--------|--------------|
| Create channel | `invalidateChannelCache()` |
| Update channel | `invalidateChannelCache()` |
| Delete channel | `invalidateChannelCache()` |

### Subscription Cache

| Action | Invalidation |
|--------|--------------|
| Subscribe | `invalidateSubscriptionCache()` |
| Unsubscribe | `invalidateSubscriptionCache()` |
| Subscription expires | `invalidateSubscriptionCache()` |
| Batch operations | `invalidateSubscriptionCache()` |

---

## Centralized Cache Helper

```typescript
// Reusable cache helper pattern

const getCached = async <T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  ttl: number = 300
): Promise<T> => {
  // Try cache first
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Fetch from source
  const data = await fetchFn();

  // Cache if data exists
  if (data !== null && data !== undefined) {
    await redisClient.setex(cacheKey, ttl, JSON.stringify(data));
  }

  return data as T;
};

// Usage
export const getSubscriberCount = async (channelId: string) => {
  return getCached(
    `channel:${channelId}:subscriber_count`,
    () => repo.getChannelSubscriberCount(channelId),
    60  // 1 minute TTL
  );
};
```

---

## Batch Cache Operations

### Multi-Get Pattern

```typescript
// Efficiently fetch multiple subscriber counts

export const getMultipleSubscriberCounts = async (channelIds: string[]) => {
  // 1. Build cache keys
  const cacheKeys = channelIds.map(id => `channel:${id}:subscriber_count`);

  // 2. Multi-get from Redis
  const cached = await redisClient.mget(...cacheKeys);

  // 3. Separate hits and misses
  const result = new Map<string, number>();
  const uncachedIds: string[] = [];

  channelIds.forEach((id, index) => {
    if (cached[index]) {
      result.set(id, parseInt(cached[index]!, 10));
    } else {
      uncachedIds.push(id);
    }
  });

  // 4. Fetch uncached from DB
  if (uncachedIds.length > 0) {
    const dbCounts = await repo.getMultipleChannelSubscriberCounts(uncachedIds);

    // 5. Cache using pipeline
    const pipeline = redisClient.pipeline();
    dbCounts.forEach((count, channelId) => {
      result.set(channelId, count);
      pipeline.setex(`channel:${channelId}:subscriber_count`, 60, count.toString());
    });
    await pipeline.exec();
  }

  return result;
};
```

---

## Performance Benefits

```
Without Cache:
──────────────────────────────────────────────────────
Request → DB Query (50-200ms) → Response
Request → DB Query (50-200ms) → Response
Request → DB Query (50-200ms) → Response

With Cache:
──────────────────────────────────────────────────────
Request → Redis (1-5ms) → Response  ← Cache Hit
Request → Redis (1-5ms) → Response  ← Cache Hit
Request → DB Query + Cache Write → Response  ← Cache Miss (rare)

Improvement: 10-40x faster for cached data
```

---

## Cache Warming

For critical data, pre-populate cache on startup:

```typescript
// Warm trending channels cache on server start
const warmCache = async () => {
  await channelRepo.getTrendingChannels(10);
  logger.info("Cache warmed: trending channels");
};
```

---

## Monitoring

### Check Cache Hit Rate

```typescript
// Add instrumentation
let cacheHits = 0;
let cacheMisses = 0;

const getCached = async <T>(key, fetchFn, ttl) => {
  const cached = await redisClient.get(key);
  if (cached) {
    cacheHits++;
    return JSON.parse(cached);
  }
  cacheMisses++;
  // ... rest
};

// Expose metrics
app.get("/metrics/cache", (req, res) => {
  res.json({
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits / (cacheHits + cacheMisses),
  });
});
```
