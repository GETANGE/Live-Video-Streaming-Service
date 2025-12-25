# User Service Documentation

## Overview

The user service handles user authentication via Google OAuth 2.0, profile management, and user-related operations with version-based cache invalidation.

---

## Architecture

```
                           USER SERVICE ARCHITECTURE

                              ┌─────────────┐
                              │   Google    │
                              │   OAuth     │
                              └──────┬──────┘
                                     │
                                     ▼
┌─────────────┐     ┌─────────────────────────────────┐     ┌─────────────┐
│   Client    │────▶│         User Service            │────▶│  Database   │
│  (Frontend) │     │  - Authentication               │     │ (Postgres)  │
└─────────────┘     │  - Profile Management           │     └─────────────┘
                    │  - Session Handling             │            │
                    └─────────────────────────────────┘            │
                                     │                             │
                                     ▼                             ▼
                              ┌─────────────┐              ┌─────────────┐
                              │   Redis     │              │  RabbitMQ   │
                              │   Cache     │              │   Queue     │
                              └─────────────┘              └─────────────┘
```

---

## Authentication Flow

### Google OAuth 2.0 Login

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE OAUTH FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User clicks "Login with Google"                                         │
│     │                                                                       │
│     ▼                                                                       │
│  GET /api/v1/users/google                                                   │
│     │                                                                       │
│     ▼                                                                       │
│  ┌───────────────────────────────────────┐                                  │
│  │         Redirect to Google            │                                  │
│  │  https://accounts.google.com/oauth    │                                  │
│  │  scope: [profile, email]              │                                  │
│  └───────────────────────────────────────┘                                  │
│     │                                                                       │
│     │  User authenticates with Google                                       │
│     ▼                                                                       │
│  GET /api/v1/users/google/callback                                          │
│     │                                                                       │
│     ▼                                                                       │
│  ┌───────────────────────────────────────┐                                  │
│  │         Google Strategy Handler       │                                  │
│  │  1. Extract profile data              │                                  │
│  │  2. Find or create user               │                                  │
│  │  3. Generate JWT tokens               │                                  │
│  └───────────────────────────────────────┘                                  │
│     │                                                                       │
│     ▼                                                                       │
│  Response:                                                                  │
│  {                                                                          │
│    accessToken: "eyJ...",                                                   │
│    refreshToken: "eyJ...",                                                  │
│    user: { id, email, username, imageUrl }                                  │
│  }                                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Token-Based Authentication

```
                    JWT AUTHENTICATION

Client ──> Request with Bearer token ──> protectRoute() ──> API

protectRoute():
┌─────────────────────────────────────────────────────────┐
│  1. Extract token from Authorization header             │
│     Authorization: Bearer eyJhbGciOiJIUzI1NiIs...       │
│                                                         │
│  2. Verify JWT signature and expiration                 │
│     verifyToken(token) → { id, email, iat, exp }        │
│                                                         │
│  3. Load user from database                             │
│     getUserByIdRepo(decoded.id)                         │
│                                                         │
│  4. Attach user to request                              │
│     req.user = user                                     │
│                                                         │
│  5. Call next() or throw 401 Unauthorized               │
└─────────────────────────────────────────────────────────┘
```

---

## Data Model

```prisma
model User {
  id          String   @id @default(uuid())
  email       String   @unique
  username    String   @unique
  phoneNumber String?
  imageUrl    String?
  isActive    Boolean  @default(true)
  isAdmin     Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  devices       UserDevice[]
  transactions  Transaction[]
  payments      Payment[]
  videos        Video[]
  notifications Notification[]
  subscription  Subscription[]
  channels      Channel[]
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `email` | String | Unique email from Google |
| `username` | String | Display name (from Google or generated) |
| `phoneNumber` | String? | For M-Pesa payments |
| `imageUrl` | String? | Profile picture from Google |
| `isActive` | Boolean | Soft delete flag |
| `isAdmin` | Boolean | Admin privileges |

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users/google` | No | Initiate Google OAuth |
| GET | `/users/google/callback` | No | Google OAuth callback |
| PATCH | `/users/profile/update` | Yes | Update profile (queued) |

### Update Profile

Profile updates are processed asynchronously via RabbitMQ:

```
┌────────────────────────────────────────────────────────────────┐
│  PATCH /api/v1/users/profile/update                            │
│  { email, username, phoneNumber }                              │
└─────────────────────────┬──────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  Controller:                                                   │
│  1. Validate email exists                                      │
│  2. Get current user                                           │
│  3. Publish to queue:                                          │
│     {                                                          │
│       eventType: "USER_PROFILE_UPDATE",                        │
│       priority: MEDIUM,                                        │
│       payload: { id, email, username, phoneNumber }            │
│     }                                                          │
│  4. Return 202 Accepted                                        │
└─────────────────────────┬──────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  Queue Handler (async):                                        │
│  1. Update user in database                                    │
│  2. Invalidate user cache                                      │
│  3. Notify user via Socket.IO                                  │
└────────────────────────────────────────────────────────────────┘
```

---

## Caching Strategy

### Version-Based Cache Invalidation

```typescript
// Location: helpers/cacheInvalidations/userCacheInvalidate.ts

const USER_VERSION_KEY = "user:version";

// Cache key generator with version
export const getUserCacheKeys = async () => {
  const version = await getUserVersion();
  return {
    byId: (id: string) => `user:id:${id}:${version}`,
    byEmail: (email: string) => `user:email:${email}:${version}`,
    all: () => `user:all:${version}`,
  };
};

// Invalidation - just increment version
export const invalidateUserCache = async () => {
  await redisClient.incr(USER_VERSION_KEY);
};
```

### Cache Keys

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `user:version` | Current version number | None |
| `user:id:{id}:{v}` | User by ID | 5 min |
| `user:email:{email}:{v}` | User by email | 5 min |
| `user:all:{v}` | All users list | 5 min |

### Cache Flow

```
GET User by ID:
───────────────────────────────────────────────────────────────
1. Get current version: GET user:version → "5"
2. Build cache key: user:id:abc123:5
3. Check cache: GET user:id:abc123:5
   │
   ├── Cache Hit → Return cached user
   │
   └── Cache Miss → Query DB → Cache result → Return

UPDATE User:
───────────────────────────────────────────────────────────────
1. Update in database
2. Invalidate cache: INCR user:version → "5" becomes "6"
3. Next request uses new version key (cache miss, fresh data)
```

---

## Service Layer

```typescript
// Location: services/user.service.ts

// Centralized cache helper
const getCachedUser = async (cacheKey: string, dbCall: () => Promise<any>) => {
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = await dbCall();
  if (!result) return null;

  await redisClient.setex(cacheKey, 300, JSON.stringify(result));  // 5 min TTL
  return result;
};

// Service functions with caching
export const getUserByIdService = async (id: string) => {
  const keys = await getUserCacheKeys();
  return getCachedUser(keys.byId(id), () => repo.getUserByIdRepo(id));
};

export const getUserByEmailService = async (email: string) => {
  const keys = await getUserCacheKeys();
  return getCachedUser(keys.byEmail(email), () => repo.getUserByEmailRepo(email));
};

// Write operations invalidate cache
export const updateUserService = async (id: string, data: any) => {
  const updated = await repo.updateUserRepo(id, data);
  await invalidateUserCache();
  return updated;
};
```

---

## Repository Layer

```typescript
// Location: repository/users.repository.ts

export const createUserRepo = async (data: Prisma.UserCreateInput) => {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (existingUser) throw new APIError("Email already in use", 400);

  return prisma.user.create({ data });
};

export const getUserByIdRepo = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new APIError("User not found", 404);
  return user;
};

// Soft delete - sets isActive to false
export const deleteUserRepo = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new APIError("User not found", 404);

  return prisma.user.update({ where: { id }, data: { isActive: false } });
};
```

---

## Authorization

### Role-Based Access

```typescript
// Admin restriction middleware
export const restrictToAdmin = () => {
  return async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return next(new APIError("Unauthorized: no user found", 401));
    }

    if (!user.isAdmin) {
      return next(new APIError("Forbidden: admin access required", 403));
    }

    next();
  };
};
```

### Usage

```typescript
// Protect route + require admin
router.delete("/users/:id", protectRoute, restrictToAdmin(), deleteUser);
```

---

## Google Strategy Configuration

```typescript
// Location: services/user.service.ts

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      // Extract user info from Google profile
      const imageUrl = profile.photos[0].value;
      const googleId = profile.id;
      const email = profile.emails[0].value;
      let username = `${profile.name.givenName} ${profile.name.familyName}`;

      // Fallback username
      if (!username) username = `user_${googleId}`;

      // Find or create user
      let user = await repo.getUserByEmailRepo(email);

      if (!user) {
        user = await repo.createUserRepo({
          email,
          username,
          imageUrl,
          isActive: true,
        });
      }

      return done(null, user);
    }
  )
);
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL |
| `JWT_SECRET` | Secret for signing tokens |
| `JWT_EXPIRES_IN` | Access token expiration |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiration |

---

## Error Responses

| Scenario | Code | Message |
|----------|------|---------|
| Email already in use | 400 | "Email already in use" |
| User not found | 404 | "User not found" |
| No token provided | 401 | "Unauthorized" |
| Invalid token | 401 | "Unauthorized" |
| Not admin | 403 | "Forbidden: admin access required" |
| Google auth failed | 500 | "Google auth failed" |

---

## Related Events

| Event | Queue | Description |
|-------|-------|-------------|
| `USER_PROFILE_UPDATE` | GENERAL | Update user profile |
