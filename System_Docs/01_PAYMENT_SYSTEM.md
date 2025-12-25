# Payment System Documentation

## Overview

The payment system handles M-Pesa STK Push payments for channel subscriptions. It uses an asynchronous callback-based architecture to process payments reliably.

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Server    │────▶│   M-Pesa    │────▶│  Callback   │
│  (Frontend) │     │   (API)     │     │   (Daraja)  │     │  (Webhook)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                                       │
                           ▼                                       ▼
                    ┌─────────────┐                         ┌─────────────┐
                    │   Redis     │                         │  Database   │
                    │  (Pending)  │                         │ (Payments)  │
                    └─────────────┘                         └─────────────┘
```

---

## Flow Diagram

### 1. Payment Initiation

```
User Request                         Server                              M-Pesa
     │                                  │                                   │
     │  POST /payments/subscribe-channel│                                   │
     │  {channelId, phoneNumber}        │                                   │
     │─────────────────────────────────▶│                                   │
     │                                  │                                   │
     │                                  │  1. Validate channel (isPaid?)    │
     │                                  │  2. Get subscriptionPrice         │
     │                                  │  3. Store in Redis:               │
     │                                  │     pending_subscription:{id}     │
     │                                  │                                   │
     │                                  │  POST /stkpush (STK Push Request) │
     │                                  │──────────────────────────────────▶│
     │                                  │                                   │
     │                                  │◀──────────────────────────────────│
     │                                  │  {CheckoutRequestID, ResponseCode}│
     │                                  │                                   │
     │                                  │  4. Queue PAYMENT_INITIATED event │
     │                                  │  5. Create Transaction (PENDING)  │
     │                                  │                                   │
     │◀─────────────────────────────────│                                   │
     │  {checkoutRequestId, message}    │                                   │
```

### 2. User Phone Interaction

```
┌────────────────────────────────────────┐
│           User's Phone                 │
│  ┌──────────────────────────────────┐  │
│  │     M-Pesa Payment Request       │  │
│  │                                  │  │
│  │  Pay KES 500 to Kenyan-Twitch?   │  │
│  │                                  │  │
│  │  Enter M-Pesa PIN: ****          │  │
│  │                                  │  │
│  │  [Confirm]         [Cancel]      │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
              │
              ▼
     User enters PIN or cancels
              │
              ▼
     M-Pesa processes & sends callback
```

### 3. Callback Processing

```
M-Pesa                              Server                           Database
   │                                   │                                 │
   │  POST /payments/callback          │                                 │
   │  {ResultCode, CheckoutRequestID}  │                                 │
   │──────────────────────────────────▶│                                 │
   │                                   │                                 │
   │                                   │  processCallback()              │
   │                                   │  ├── Find Transaction           │
   │                                   │  │                              │
   │                                   │  ├── ResultCode === 0?          │
   │                                   │  │   ├── YES: handleSuccess()   │
   │                                   │  │   └── NO:  handleFailure()   │
   │                                   │                                 │
   │◀──────────────────────────────────│                                 │
   │  {ResultCode: 0, ResultDesc}      │                                 │
```

---

## Key Functions

### `processCallback(callbackData)`
Main entry point for M-Pesa callbacks.

```typescript
// Location: services/payment.service.ts

export const processCallback = async (callbackData) => {
  // 1. Find transaction by CheckoutRequestID
  // 2. Route to success or failure handler
  // 3. Return result
}
```

### `handleSuccessfulPayment(callbackData, transaction)`
Handles successful payment (ResultCode === 0).

```typescript
// Steps:
// 1. Update Transaction status → COMPLETED
// 2. Check Redis for pending subscription
// 3. Create Payment record
// 4. If subscription pending → handleChannelSubscription()
// 5. Notify user via Socket.IO
```

### `handleChannelSubscription(pendingSubscription, paymentId, ...)`
Creates subscription after successful payment.

```typescript
// Steps:
// 1. Call subscriptionService.subscribeWithPayment()
// 2. Remove pending subscription from Redis
// 3. Notify user: "You are now subscribed!"
```

### `handleFailedPayment(checkoutRequestId, userId, ...)`
Handles failed payment (ResultCode !== 0).

```typescript
// Steps:
// 1. Update Transaction status → FAILED
// 2. Remove pending subscription from Redis (if exists)
// 3. Notify user: "Payment failed"
```

---

## Data Models

### Transaction
```prisma
model Transaction {
  id            String            @id @default(uuid())
  amount        Float
  status        TransactionStatus @default(PENDING)  // PENDING | COMPLETED | FAILED
  transactionId String?           @unique            // CheckoutRequestID
  userId        String
  createdAt     DateTime          @default(now())
}
```

### Payment
```prisma
model Payment {
  id            String        @id @default(uuid())
  amount        Float
  status        PaymentStatus @default(PENDING)
  transactionId String?       @unique              // M-Pesa Receipt Number
  userId        String
  method        String                             // "mpesa"
  channelId     String?                            // For channel subscriptions
  purpose       String?                            // "CHANNEL_SUBSCRIPTION"
}
```

---

## Redis Keys

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `pending_subscription:{checkoutRequestId}` | Store pending subscription while awaiting payment | 1 hour |

### Pending Subscription Structure
```json
{
  "userId": "user-123",
  "channelId": "channel-456",
  "amount": 500,
  "phoneNumber": "254712345678",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

---

## M-Pesa Result Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Insufficient Balance |
| 1032 | Request cancelled by user |
| 1037 | DS timeout |
| 2001 | Wrong PIN |

---

## API Endpoints

### POST `/api/v1/payments/subscribe-channel`
Initiate payment for channel subscription.

**Request:**
```json
{
  "channelId": "channel-uuid",
  "phoneNumber": "254712345678"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment of KES 500 initiated for \"Channel Name\". Check your phone.",
  "data": {
    "checkoutRequestId": "ws_CO_123...",
    "merchantRequestId": "abc-123",
    "channelName": "Channel Name",
    "amount": 500,
    "currency": "KES"
  }
}
```

### POST `/api/v1/payments/callback`
M-Pesa callback webhook (called by M-Pesa, not clients).

### POST `/api/v1/payments/initiate`
Generic STK Push (not for subscriptions).

### GET `/api/v1/payments/history`
Get user's payment and transaction history.

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Channel not found | 404: "Channel not found" |
| Channel is free | 400: "This channel is free. No payment required." |
| Missing price | 400: "Channel subscription price not set" |
| Pending payment exists | 400: "You already have a pending payment for this channel" |
| Payment failed | Socket.IO notification with error message |
| Subscription creation failed | Socket.IO notification to contact support |

---

## Security Considerations

1. **Callback Validation**: M-Pesa callbacks should be validated (IP whitelist recommended)
2. **Idempotency**: CheckoutRequestID is unique - prevents duplicate processing
3. **Timeout Handling**: Pending subscriptions expire after 1 hour in Redis
4. **Error Recovery**: If subscription fails after payment, user is notified to contact support
