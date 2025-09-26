# @verifiedinc/feathers-redis

> A Feathers Service Adapter for Redis using `redis-om`

This adapter is a drop-in replacement for the default Feathers database adapter. It leverages the [`redis-om`](https://github.com/redis/redis-om-node) package to store data in a Redis database while providing a common API for initialization, CRUD operations, and query syntax.

⚠️ **Requirements**: This adapter requires a Redis instance with the **RediSearch** and **RedisJSON** modules enabled. These modules power full-text search, indexing, and JSON-based document storage used by `redis-om`.

You can use [Redis Stack](https://redis.io/docs/stack/) locally via Docker or in the cloud to ensure these modules are available.

## Installation

```sh
npm install @verifiedinc/feathers-redis --save
```

## Usage

### Setting Up the Redis Client

To integrate the adapter in a FeathersJS project, you first need to initialize the Redis client. Create a file (e.g., `src/redis.ts`) and set up the client with proper event listeners:

```typescript
// src/redis.ts
import type { Application } from './declarations';
import { logger } from './logger';
import { createClient, type RedisClientType } from 'redis';

declare module './declarations' {
  interface Configuration {
    redisClient: RedisClientType;
  }
}

/**
 * Initializes and configures a Redis client for the given application.
 *
 * @param {Application} app - The application instance to configure the Redis client for.
 * @throws {Error} Throws an error if the Redis configuration is not found.
 */
export const redis = (app: Application): void => {
  const config = app.get('redis');
  if (!config) {
    throw new Error('Redis configuration not found');
  }

  const db: RedisClientType = createClient({
    url: config.host,
    password: config.password,
  });

  db.on('error', (err) => {
    logger.error('Redis client error', err);
  });
  db.on('connect', () => {
    logger.info('Redis client connected');
  });
  db.on('ready', () => {
    logger.info('Redis client ready');
  });
  db.on('end', () => {
    logger.warn('Redis client connection closed');
  });
  db.on('reconnecting', () => {
    logger.info('Redis client reconnecting');
  });
  db.on('close', () => {
    logger.warn('Redis client connection closed unexpectedly');
  });
  db.on('socketError', (err) => {
    logger.error('Redis client socket error', err);
  });

  void db.connect().then(() => {
    logger.info(`Redis client connected to master: ${JSON.stringify(db.options)}`);
  });

  app.set('redisClient', db);
};
```

### Configuring the Application

Define your application configuration, including Redis settings. For example, in `src/configuration.ts`:

```typescript
// src/configuration.ts
import { Type, getValidator, defaultAppConfiguration } from '@feathersjs/typebox';
import type { Static } from '@feathersjs/typebox';
import { dataValidator } from './validators';

export const configurationSchema = Type.Intersect([
  defaultAppConfiguration,
  Type.Object({
    host: Type.String(),
    port: Type.Number(),
    public: Type.String(),
    // Redis Configuration
    redis: Type.Optional(
      Type.Object({
        host: Type.String(),
        password: Type.Optional(Type.String()),
      }),
    ),
  }),
]);

export type ApplicationConfiguration = Static<typeof configurationSchema>;
export const configurationValidator = getValidator(configurationSchema, dataValidator);
```

### Integrating Redis with the Application

In your main application file (e.g., `src/app.ts`), configure the Redis client:

```typescript
// src/app.ts
// ...
import { redis } from './redis';
// ...
app.configure(redis);
//...
```

### Creating a Service

Use the adapter to create a service. For example, here’s how you might define a message service in `src/services/message/message.class.ts`:

```typescript
// src/services/message/message.class.ts
import type { Params } from '@feathersjs/feathers';
import type { Application } from '../../declarations';
import type { Message, MessageData, MessagePatch, MessageQuery } from './message.schema';
import { type RedisAdapterParams, RedisService, type RedisAdapterOptions } from '@verifiedinc/feathers-redis';
import { Schema } from 'redis-om';

export type { Message, MessageData, MessagePatch, MessageQuery };

export interface MessageParams extends RedisAdapterParams<MessageQuery> {}

export class MessageService<ServiceParams extends Params = MessageParams> extends RedisService<
  Message,
  MessageData,
  MessageParams,
  MessagePatch
> {}

export const getOptions = (app: Application): RedisAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('redisClient'),
    schema: new Schema('messages', {
      id: { type: 'string' },
      text: { type: 'string' },
      userId: { type: 'string' },
      createdAt: { type: 'number' },
    }),
  };
};
```

## Expiration Management

This adapter provides comprehensive expiration management features to automatically expire records after a specified time.

### Default Expiration Configuration

Set a default expiration time for all records created by a service:

```typescript
export const getOptions = (app: Application): RedisAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('redisClient'),
    expiration: 3600, // 1 hour in seconds
    schema: new Schema('messages', {
      id: { type: 'string' },
      text: { type: 'string' },
      userId: { type: 'string' },
      createdAt: { type: 'number' },
    }),
  };
};
```

With default expiration configured:

- **Single records**: Automatically get expiration set on create
- **Batch records**: All items in batch creation get expiration (requires `multi: ['create']`)

```typescript
// Single create - automatically expires after 1 hour
const message = await app.service('messages').create({
  text: 'Hello world',
  userId: '123',
  createdAt: Date.now(),
});

// Batch create - all items automatically expire after 1 hour
const messages = await app.service('messages').create(
  [
    { text: 'Message 1', userId: '123', createdAt: Date.now() },
    { text: 'Message 2', userId: '456', createdAt: Date.now() },
  ],
  { provider: undefined },
); // Requires multi: ['create'] in service options
```

### Manual Expiration Control

Override or set expiration for individual records:

```typescript
// Set custom expiration time (24 hours)
await app.service('messages').expire(message.id, 60 * 60 * 24);

// Set expiration using the entity object
await app.service('messages').expire(message, 60 * 60 * 24);
```

### Expiration Refresh on Updates

Control whether expiration times are refreshed during update/patch operations:

```typescript
// Update WITH expiration refresh (resets expiration to default time)
await app.service('messages').update(id, updatedData, {
  refreshExpiration: true,
});

// Update WITHOUT expiration refresh (preserves original expiration)
await app.service('messages').update(id, updatedData);

// Patch WITH expiration refresh
await app.service('messages').patch(id, patchData, {
  refreshExpiration: true,
});

// Patch WITHOUT expiration refresh (default behavior)
await app.service('messages').patch(id, patchData);
```

### Expiration Scenarios

| Operation  | Default Behavior                   | With `refreshExpiration: true`     |
| ---------- | ---------------------------------- | ---------------------------------- |
| `create()` | ✅ Sets expiration (if configured) | N/A                                |
| `update()` | ❌ No expiration change            | ✅ Refreshes to default expiration |
| `patch()`  | ❌ No expiration change            | ✅ Refreshes to default expiration |

### Complete Service Example with Expiration

```typescript
export const getOptions = (app: Application): RedisAdapterOptions => {
  return {
    paginate: app.get('paginate'),
    Model: app.get('redisClient'),
    expiration: 1800, // 30 minutes default expiration
    multi: ['create'], // Enable batch operations
    schema: new Schema('sessions', {
      sessionId: { type: 'string' },
      userId: { type: 'string' },
      data: { type: 'string' },
      createdAt: { type: 'number' },
    }),
  };
};

// Usage examples:
const sessionService = app.service('sessions');

// Create session with 30-minute expiration
const session = await sessionService.create({
  sessionId: 'sess_123',
  userId: 'user_456',
  data: JSON.stringify({ theme: 'dark' }),
  createdAt: Date.now(),
});

// Update session and refresh expiration to another 30 minutes
await sessionService.patch(
  session.sessionId,
  {
    data: JSON.stringify({ theme: 'light' }),
  },
  { refreshExpiration: true },
);

// Set custom expiration (2 hours)
await sessionService.expire(session.sessionId, 7200);
```

## Limitations

- The current implementation does not support nested objects. This means that if you try to query a nested object, it will not work as expected.
- You need to use the `redis-om` package to create the indexes for your models.
- The following methods are not implemented yet:
  - **`.find + $in`**: Redis-OM doesn't support `$in` (see [issue #245](https://github.com/redis/redis-om-node/issues/245)).
  - **`.find + $nin`**: Redis-OM doesn't support `$nin` (see [issue #245](https://github.com/redis/redis-om-node/issues/245)).
  - **`.get + NotFound (integer)`**: Not implemented (currently not required).
  - **`.remove + NotFound (integer)`**: Not implemented (currently not required).
  - **`.remove + multi`**: Redis-OM doesn't support multi remove, so removals must be performed in a loop.
  - **`.remove + multi no pagination`**: Redis-OM doesn't support multi remove; looping is required.
  - **`.update + NotFound (integer)`**: Not implemented (currently not required).
  - **`.patch multiple`**: Redis-OM doesn't support multi patch; operations must be looped.
  - **`.patch multiple no pagination`**: Redis-OM doesn't support multi patch; operations must be looped.
  - **`.patch multi query same`**: Redis-OM doesn't support multi patch; operations must be looped.
  - **`.patch multi query changed`**: Redis-OM doesn't support multi patch; operations must be looped.
  - **`.patch + NotFound (integer)`**: Not implemented (currently not required).
  - **`params.adapter + multi`**: Redis-OM doesn't support multi patch; operations must be looped.

## Future Improvements & Nice-to-Have Features

- **Nested Object Support:** Investigate ways to support queries on nested objects.
- **Enhanced Batch Operations:** Explore alternatives or workarounds for multi remove/patch operations to avoid looping over individual items.
- **Improved Index Management:** Provide utility functions to manage indexes more easily.
- **Advanced Expiration Features:** Add support for custom expiration callbacks, expiration events, and conditional expiration logic.
- **Performance Optimizations:** Implement connection pooling and query optimization strategies.
- **Enhanced Documentation:** Add more real-world examples and integration guides.

## Reference

For more details and ongoing discussion, see the [Feathers Redis Issue #4](https://github.com/feathersjs-ecosystem/feathers-redis/issues/4).

## Publishing and Release Process

This package uses an automated release workflow similar to Axios:

### How to Release

1. **Create a GitHub Release**:
   - Go to [GitHub Releases](https://github.com/VerifiedInc/feathers-redis/releases)
   - Click "Create a new release"
   - Set tag version (e.g., `v1.0.0`)
   - Add release notes

2. **Automated PR Creation**:
   - GitHub automatically creates a PR with the version bump
   - The PR updates `package.json` with the new version
   - Review the PR to ensure everything looks correct

3. **Publish to npm**:
   - Merge the PR to `main`
   - GitHub automatically publishes to npm with provenance
   - Uses GitHub OIDC (Trusted Publisher) for secure authentication

### Workflow Details

- **Release PR Workflow** (`.github/workflows/release-pr.yml`): Creates PR when release is created
- **Publish Workflow** (`.github/workflows/publish.yml`): Publishes to npm when `package.json` version changes on main
- **Security**: Uses GitHub as Trusted Publisher (no npm tokens needed)
- **Provenance**: All packages published with attestation for supply chain security

This ensures a clean separation between version management and publishing, with full audit trail.

## License

Licensed under the [MIT license](LICENSE).
