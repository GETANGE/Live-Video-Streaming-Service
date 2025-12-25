# Notification Service Documentation

## Overview

The notification service provides both persistent database notifications and real-time Socket.IO notifications. It supports subscription lifecycle events, payment notifications, and channel updates.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         ┌────────────────┐                                  │
│                         │   Triggers     │                                  │
│                         │                │                                  │
│                         │ - Subscription │                                  │
│                         │ - Payment      │                                  │
│                         │ - Channel      │                                  │
│                         └───────┬────────┘                                  │
│                                 │                                           │
│                    ┌────────────┼────────────┐                              │
│                    │            │            │                              │
│                    ▼            ▼            ▼                              │
│            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                  │
│            │  Database   │ │  Socket.IO  │ │  RabbitMQ   │                  │
│            │  Storage    │ │  Real-time  │ │   Queue     │                  │
│            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘                  │
│                   │               │               │                         │
│                   │               │               │                         │
│                   ▼               ▼               ▼                         │
│            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                  │
│            │ Persistent  │ │  Instant    │ │   Async     │                  │
│            │ History     │ │  Delivery   │ │ Processing  │                  │
│            └─────────────┘ └─────────────┘ └─────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Notification Types

### 1. Database Notifications (Persistent)

Stored in PostgreSQL for history and retrieval:

```prisma
model Notification {
  id        String           @id @default(uuid())
  message   String
  type      NotificationType  // INFO | ALERT | WARNING
  userId    String?
  isRead    Boolean          @default(false)
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  user User? @relation(fields: [userId], references: [id])
}

enum NotificationType {
  INFO      // General information
  ALERT     // Requires attention
  WARNING   // Urgent notification
}
```

### 2. Socket.IO Notifications (Real-time)

Instant delivery to connected clients:

```typescript
emitNotification(userId, {
  type: "PAYMENT_SUCCESS",
  message: "Payment completed successfully",
  amount: 500,
  timestamp: new Date().toISOString(),
});
```

---

## Notification Flow

### Creating Notifications

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NOTIFICATION CREATION FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Trigger Event (e.g., New Subscription)                                     │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  notificationService.notifyNewSubscription(subscription)            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│         │                                                                   │
│         ├──────────────────────────────────────────────────────────┐        │
│         │                                                          │        │
│         ▼                                                          ▼        │
│  ┌─────────────────────────┐                          ┌─────────────────┐   │
│  │  1. Create DB record    │                          │ 2. Publish to   │   │
│  │     repo.createNotif()  │                          │    RabbitMQ     │   │
│  └─────────────────────────┘                          └────────┬────────┘   │
│         │                                                      │            │
│         │                                                      ▼            │
│         │                                          ┌─────────────────────┐  │
│         │                                          │ 3. Socket.IO emit  │  │
│         │                                          │    to channel owner│  │
│         ▼                                          └─────────────────────┘  │
│  ┌─────────────────────────┐                                                │
│  │  Stored for later       │                                                │
│  │  retrieval via API      │                                                │
│  └─────────────────────────┘                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notifications` | Yes | Get all notifications |
| GET | `/notifications/unread` | Yes | Get unread notifications |
| PATCH | `/notifications/read-all` | Yes | Mark all as read (queued) |
| PATCH | `/notifications/:id/read` | Yes | Mark single as read (queued) |
| DELETE | `/notifications/:id` | Yes | Delete notification (queued) |

### Read Operations (Synchronous)

```
GET /api/v1/notifications
─────────────────────────────────────────────
Response: 200 OK
{
  "success": true,
  "data": [
    {
      "id": "notif-123",
      "message": "New subscriber to your channel",
      "type": "INFO",
      "isRead": false,
      "createdAt": "2024-01-15T10:30:00Z"
    },
    ...
  ]
}
```

### Write Operations (Async via Queue)

Write operations are processed asynchronously for better performance:

```
PATCH /api/v1/notifications/:id/read
─────────────────────────────────────────────
1. Publish to queue:
   {
     eventType: "NOTIFICATION_MARK_READ",
     priority: LOW,
     payload: { notificationId, userId }
   }

2. Response: 202 Accepted
   { "message": "Notification will be marked as read" }

3. Queue handler:
   - Updates DB
   - Emits Socket.IO: { type: "NOTIFICATION_UPDATED", isRead: true }
```

---

## Event Handlers

### NOTIFICATION_MARK_READ

```typescript
// Location: events/consumers/eventHandlers/notification_handlers/notification_read.ts

export const handleNotificationMarkRead = async (payload: MarkReadPayload) => {
  const { notificationId, userId } = payload;

  // Update in database
  await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });

  // Notify client via Socket.IO
  await emitNotification(userId, {
    type: "NOTIFICATION_UPDATED",
    notificationId,
    isRead: true,
  });
};
```

### NOTIFICATION_MARK_ALL_READ

```typescript
// Location: events/consumers/eventHandlers/notification_handlers/notification_readAll.ts

export const handleNotificationMarkAllRead = async (payload: MarkAllReadPayload) => {
  const { userId } = payload;

  // Bulk update
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  // Notify client
  await emitNotification(userId, {
    type: "ALL_NOTIFICATIONS_READ",
    count: result.count,
  });
};
```

### NOTIFICATION_DELETE

```typescript
// Location: events/consumers/eventHandlers/notification_handlers/notification_delete.ts

export const handleNotificationDelete = async (payload: DeletePayload) => {
  const { notificationId, userId } = payload;

  // Delete from database
  await prisma.notification.delete({
    where: { id: notificationId },
  });

  // Notify client
  await emitNotification(userId, {
    type: "NOTIFICATION_DELETED",
    notificationId,
  });
};
```

---

## Subscription Notifications

### notifyNewSubscription

```typescript
// When user subscribes to a channel
export const notifyNewSubscription = async (subscription: Subscription) => {
  // 1. Create persistent notification for channel owner
  await repo.createNotification({
    message: `New subscriber to your channel`,
    type: "INFO",
    userId: subscription.channelId,  // channel owner
  });

  // 2. Publish event to queue for async processing
  publishSubscriptionEventAsync(SUBSCRIPTION_EVENTS.SUBSCRIBED, subscription);

  // 3. Real-time notification to channel owner
  notifyChannelOwner(subscription.channelId, subscription.userId, "subscribed");
};
```

### sendExpirationReminders

```typescript
// Batch notification for expiring subscriptions
export const sendExpirationReminders = async (subscriptions: Subscription[]) => {
  // 1. Create bulk notifications
  const notifications = subscriptions
    .filter((s) => s.user?.id)
    .map((s) => ({
      message: `Your subscription to ${s.channel?.name} expires soon`,
      type: "ALERT" as const,
      userId: s.user!.id,
    }));

  if (notifications.length > 0) {
    await repo.createManyNotifications(notifications);
  }

  // 2. Queue events and emit real-time for each
  for (const subscription of subscriptions) {
    publishSubscriptionEventAsync(SUBSCRIPTION_EVENTS.EXPIRING_SOON, subscription);

    if (subscription.user?.id) {
      notifyUser(subscription.user.id, {
        type: "SUBSCRIPTION_EXPIRING",
        message: `Your subscription to ${subscription.channel?.name} expires soon`,
        channelId: subscription.channelId,
        expiresAt: subscription.endDate,
      });
    }
  }
};
```

---

## Socket.IO Integration

### Event Helper Functions

```typescript
// Location: helpers/event.helper.ts

// Send notification to specific user
export const notifyUser = (userId: string, notification: object): void => {
  emitNotification(userId, {
    ...notification,
    timestamp: new Date().toISOString(),
  });
};

// Send notification to channel room (all subscribers)
export const notifyChannel = (channelId: string, notification: object): void => {
  emitNotification(`channel:${channelId}`, {
    ...notification,
    channelId,
    timestamp: new Date().toISOString(),
  });
};

// Notify channel owner of subscriber action
export const notifyChannelOwner = (
  channelId: string,
  subscriberId: string,
  action: "subscribed" | "unsubscribed"
): void => {
  notifyChannel(channelId, {
    type: "SUBSCRIBER_UPDATE",
    action,
    subscriberId,
  });
};
```

---

## Socket.IO Event Types

### Client-Bound Events

| Event Type | Payload | Trigger |
|------------|---------|---------|
| `NOTIFICATION_UPDATED` | `{ notificationId, isRead }` | Mark as read |
| `ALL_NOTIFICATIONS_READ` | `{ count }` | Mark all as read |
| `NOTIFICATION_DELETED` | `{ notificationId }` | Delete notification |
| `PAYMENT_SUCCESS` | `{ amount, receipt, ... }` | Payment completed |
| `PAYMENT_FAILED` | `{ message, code }` | Payment failed |
| `SUBSCRIPTION_SUCCESS` | `{ channelId, channelName }` | Subscription created |
| `SUBSCRIPTION_EXPIRING` | `{ channelId, expiresAt }` | Expiration reminder |
| `SUBSCRIBER_UPDATE` | `{ action, subscriberId }` | New/lost subscriber |

---

## Repository Layer

```typescript
// Location: repository/notification.repository.ts

// Create single notification
export const createNotification = async (data: CreateNotificationData) => {
  return prisma.notification.create({ data });
};

// Create multiple notifications (batch)
export const createManyNotifications = async (data: CreateNotificationData[]) => {
  return prisma.notification.createMany({ data });
};

// Get all notifications for user (newest first)
export const getNotificationsByUserId = async (userId: string) => {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
};

// Get only unread notifications
export const getUnreadNotifications = async (userId: string) => {
  return prisma.notification.findMany({
    where: { userId, isRead: false },
    orderBy: { createdAt: "desc" },
  });
};

// Mark single as read
export const markAsRead = async (id: string) => {
  return prisma.notification.update({
    where: { id },
    data: { isRead: true },
  });
};

// Mark all as read for user
export const markAllAsRead = async (userId: string) => {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
};

// Delete notification
export const deleteNotification = async (id: string) => {
  return prisma.notification.delete({ where: { id } });
};
```

---

## Queue Integration

### Events Routed to GENERAL Queue

| Event | Priority | Handler |
|-------|----------|---------|
| `NOTIFICATION_MARK_READ` | LOW | `handleNotificationMarkRead` |
| `NOTIFICATION_MARK_ALL_READ` | LOW | `handleNotificationMarkAllRead` |
| `NOTIFICATION_DELETE` | MEDIUM | `handleNotificationDelete` |

### Why Queue Write Operations?

```
Without Queue:
─────────────────────────────────────────────
Client ──> Mark Read ──> DB Write ──> Response
                          │
                          └── Blocks until complete

With Queue:
─────────────────────────────────────────────
Client ──> Mark Read ──> Queue ──> 202 Accepted (instant)
                          │
                          └── Async: DB Write + Socket.IO

Benefits:
- Faster API response (non-blocking)
- Better UX
- Batch processing possible
- Retry on failure
```

---

## Notification Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      NOTIFICATION LIFECYCLE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐  │
│  │   Created   │────▶│   Unread    │────▶│    Read     │────▶│  Deleted  │  │
│  │             │     │             │     │             │     │           │  │
│  └─────────────┘     └─────────────┘     └─────────────┘     └───────────┘  │
│                            │                   │                            │
│                            │                   │                            │
│                            ▼                   ▼                            │
│                    ┌───────────────────────────────────────┐                │
│                    │     GET /notifications/unread        │                │
│                    │     Returns only isRead: false        │                │
│                    └───────────────────────────────────────┘                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Frontend Integration

### Listening to Socket Events

```javascript
// Example: React/JavaScript client

socket.on("notification", (data) => {
  switch (data.type) {
    case "NOTIFICATION_UPDATED":
      // Mark notification as read in local state
      updateNotification(data.notificationId, { isRead: true });
      break;

    case "ALL_NOTIFICATIONS_READ":
      // Mark all as read
      markAllNotificationsRead();
      showToast(`${data.count} notifications marked as read`);
      break;

    case "PAYMENT_SUCCESS":
      // Show success message
      showToast(`Payment of ${data.amount} received!`);
      break;

    case "SUBSCRIPTION_EXPIRING":
      // Show warning
      showWarning(`Your subscription to ${data.channelName} expires soon`);
      break;

    case "SUBSCRIBER_UPDATE":
      if (data.action === "subscribed") {
        incrementSubscriberCount();
        showToast("New subscriber!");
      }
      break;
  }
});
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Unauthorized | 401: "Unauthorized" |
| Notification ID missing | 400: "Notification ID required" |
| Notification not found | Queue handler logs error, no client impact |

---

## Database Indexes

```prisma
model Notification {
  // Indexes for efficient queries
  @@index([userId])      // Get user's notifications
  @@index([type])        // Filter by type
  @@index([isRead])      // Get unread only
  @@index([createdAt])   // Order by date
  @@index([message])     // Search in messages
}
```
