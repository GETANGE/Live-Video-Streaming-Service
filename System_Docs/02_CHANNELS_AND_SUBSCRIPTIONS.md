# Channels & Subscriptions Documentation

## Overview

The channel system allows users to create channels (like YouTube/Twitch), upload videos, and monetize through paid subscriptions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CHANNEL SYSTEM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐            │
│  │   Channel   │────────▶│   Videos    │         │Subscriptions│            │
│  │   Owner     │         │             │         │             │            │
│  └─────────────┘         └─────────────┘         └─────────────┘            │
│        │                                               ▲                    │
│        │                                               │                    │
│        │         ┌─────────────────────────────────────┘                    │
│        │         │                                                          │
│        ▼         ▼                                                          │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │    FREE Channel     │         │    PAID Channel     │                    │
│  │  (Direct Subscribe) │         │ (Payment Required)  │                    │
│  └─────────────────────┘         └─────────────────────┘                    │
│                                           │                                 │
│                                           ▼                                 │
│                                  ┌─────────────────┐                        │
│                                  │  M-Pesa Payment │                        │
│                                  └─────────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### Channel
```prisma
model Channel {
  id                String   @id @default(uuid())
  name              String   @unique
  description       String?
  ownerId           String

  // Paid channel settings
  isPaid            Boolean  @default(false)
  subscriptionPrice Float?
  currency          String   @default("KES")

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  owner         User           @relation(...)
  subscriptions Subscription[]
  videos        Video[]
}
```

### Subscription
```prisma
model Subscription {
  id          String             @id @default(uuid())
  userId      String
  channelId   String
  status      SubscriptionStatus @default(ACTIVE)  // ACTIVE | EXPIRED | CANCELLED
  startDate   DateTime           @default(now())
  endDate     DateTime?

  // Payment tracking for paid channels
  paymentId   String?
  amountPaid  Float?

  user    User
  channel Channel
  payment Payment?

  @@unique([userId, channelId])
}
```

---

## Channel Types

### Free Channel
```
User ──▶ POST /subscriptions ──▶ Subscription Created ──▶ Done
```

### Paid Channel
```
User ──▶ POST /subscriptions ──▶ 402 Payment Required
                                        │
                                        ▼
User ──▶ POST /payments/subscribe-channel ──▶ STK Push ──▶ Pay ──▶ Subscription Created
```

---

## Subscription Flow

### Free Channel Subscription

```
┌────────────────────────────────────────────────────────────────┐
│  POST /api/v1/subscriptions                                    │
│  { channelId: "free-channel-123" }                             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  subscriptionService.subscribe()                               │
│                                                                │
│  1. Get channel from DB                                        │
│  2. Check: channel.isPaid === false ✓                          │
│  3. Check existing subscription                                │
│  4. Create subscription                                        │
│  5. Invalidate cache                                           │
│  6. Notify user                                                │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Response: 201 Created                                         │
│  { success: true, data: { subscription } }                     │
└────────────────────────────────────────────────────────────────┘
```

### Paid Channel Subscription

```
┌────────────────────────────────────────────────────────────────┐
│  POST /api/v1/subscriptions                                    │
│  { channelId: "paid-channel-456" }                             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  subscriptionService.subscribe()                               │
│                                                                │
│  1. Get channel from DB                                        │
│  2. Check: channel.isPaid === true ✗                           │
│  3. Return 402 Payment Required                                │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Response: 402 Payment Required                                │
│  {                                                             │
│    error: "This is a paid channel. Subscription costs          │
│            KES 500. Use /payments/subscribe-channel"           │
│  }                                                             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  User calls: POST /api/v1/payments/subscribe-channel           │
│  { channelId: "paid-channel-456", phoneNumber: "254..." }      │
│                                                                │
│  → See PAYMENT_SYSTEM.md for payment flow                      │
│  → After successful payment, subscription is auto-created      │
└────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Channels

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/channels` | No | List all channels |
| GET | `/channels/search?q=` | No | Search channels |
| GET | `/channels/trending` | No | Get trending channels |
| GET | `/channels/:id` | No | Get channel by ID |
| GET | `/channels/:id/videos` | No | Get channel videos |
| GET | `/channels/:id/stats` | No | Get channel stats |
| POST | `/channels` | Yes | Create channel |
| GET | `/channels/me` | Yes | Get my channel |
| PUT | `/channels/:id` | Yes | Update channel |
| DELETE | `/channels/:id` | Yes | Delete channel |

### Create/Update Channel (with pricing)

**Request:**
```json
{
  "name": "Premium Gaming",
  "description": "Exclusive gaming content",
  "isPaid": true,
  "subscriptionPrice": 500,
  "currency": "KES"
}
```

### Subscriptions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/subscriptions` | Yes | Subscribe to channel |
| DELETE | `/subscriptions/:channelId` | Yes | Unsubscribe |
| GET | `/subscriptions` | Yes | My subscriptions |
| GET | `/subscriptions/active` | Yes | My active subscriptions |

---

## Caching Strategy

### Cache Keys (Version-based invalidation)

```
channel:version                    → Current version number
channel:version:id:{id}:{v}        → Channel by ID
channel:version:name:{name}:{v}    → Channel by name
channel:version:owner:{ownerId}:{v}→ Channel by owner
channel:version:stats:{id}:{v}     → Channel stats
channel:version:trending:{v}       → Trending channels
```

### Cache Invalidation

```typescript
// When channel is created/updated/deleted:
await invalidateChannelCache();  // Increments version number

// All old cache keys become orphaned (different version)
// New requests get fresh data and cache with new version
```

### TTL Settings

| Cache Type | TTL |
|------------|-----|
| Channel by ID | 5 minutes |
| Channel by Name | 5 minutes |
| Channel by Owner | 5 minutes |
| Channel Stats | 5 minutes |
| Trending Channels | 10 minutes |

---

## Event System (Queues)

### Channel Events

| Event | Queue | Description |
|-------|-------|-------------|
| `CHANNEL_CREATED` | GENERAL | Notify owner, index for search |
| `CHANNEL_UPDATED` | GENERAL | Notify subscribers |
| `CHANNEL_DELETED` | VIDEO | Heavy operation - delete videos, notify subscribers |

### Channel Created Handler
```typescript
// Location: events/consumers/eventHandlers/channel_handlers/channel_created.ts

// 1. Create welcome notification for owner
// 2. Notify owner via Socket.IO
```

### Channel Updated Handler
```typescript
// Location: events/consumers/eventHandlers/channel_handlers/channel_updated.ts

// 1. Get all active subscribers
// 2. Create notifications for subscribers
// 3. Notify via Socket.IO
```

### Channel Deleted Handler
```typescript
// Location: events/consumers/eventHandlers/channel_handlers/channel_deleted.ts

// 1. Verify ownership
// 2. Delete all videos from MinIO/CDN
// 3. Notify all subscribers
// 4. Delete channel from DB (cascades)
// 5. Notify owner
```

---

## Channel Stats

```typescript
// GET /api/v1/channels/:id/stats

{
  "subscriberCount": 1500,
  "videoCount": 45,
  "totalDuration": 86400  // seconds
}
```

---

## Trending Algorithm

Channels are ranked by subscriber growth in the last 7 days:

```sql
SELECT channelId, COUNT(*) as recentSubscribers
FROM subscriptions
WHERE status = 'ACTIVE'
  AND createdAt >= NOW() - INTERVAL '7 days'
GROUP BY channelId
ORDER BY recentSubscribers DESC
LIMIT 10
```

---

## Business Rules

| Rule | Implementation |
|------|----------------|
| One channel per user | Check `getChannelByOwner()` before creation |
| Unique channel names | Database constraint + validation |
| Paid channels need price | Validation: if `isPaid`, `subscriptionPrice > 0` |
| Owner can't subscribe to own channel | Frontend validation (can add backend) |
| Deleting channel queued | Heavy operation → VIDEO queue |

---

## Error Responses

| Scenario | Code | Message |
|----------|------|---------|
| Channel name taken | 400 | "Channel name already taken" |
| Already has channel | 400 | "You already have a channel" |
| Channel not found | 404 | "Channel not found" |
| Not channel owner | 403 | "You don't own this channel" |
| Paid channel, no price | 400 | "Paid channels must have a valid subscription price" |
| Already subscribed | 400 | "Already subscribed to this channel" |
| Paid channel subscribe | 402 | "This is a paid channel. Use /payments/subscribe-channel" |
