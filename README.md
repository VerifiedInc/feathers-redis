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

### Setting an Expiration Time

You can also set an expiration time for records. For example, to expire a message after one day:

```typescript
// Creating a new message and setting an expiration time in seconds (24 hours)
const message = await app.service('messages').create({
  text: 'Hello world',
  userId: '123',
  createdAt: Date.now(),
});

// Set expiration time for the message (in seconds)
await app.service('messages').expire(message.id, 60 * 60 * 24);
```

> **Note:** It would be nice to set a default expiration time for all messages in the service options in future releases.

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

- **Default Expiration Settings:** Add an option to set a default expiration time for all messages within the service options.
- **Nested Object Support:** Investigate ways to support queries on nested objects.
- **Enhanced Batch Operations:** Explore alternatives or workarounds for multi remove/patch operations to avoid looping over individual items.
- **Improved Index Management:** Provide utility functions to manage indexes more easily.
- **Documentation:** Expand documentation to cover all features and provide more examples.
- **Testing:** Implement comprehensive unit and integration tests to ensure reliability and performance.

## Reference

For more details and ongoing discussion, see the [Feathers Redis Issue #4](https://github.com/feathersjs-ecosystem/feathers-redis/issues/4).

## License

Licensed under the [MIT license](LICENSE).
