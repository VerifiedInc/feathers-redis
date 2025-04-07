import { RedisConnection, Schema } from 'redis-om';
import adapterTests from '@feathersjs/adapter-tests';
import { Ajv, getValidator, hooks, querySyntax } from '@feathersjs/schema';
import { feathers } from '@feathersjs/feathers';
import errors from '@feathersjs/errors';
import { RedisService } from '../src';
import { createClient } from 'redis';

const testSuite = adapterTests([
  '.options',
  '.events',
  '._get',
  '._find',
  '._create',
  '._update',
  '._patch',
  '._remove',
  '.get',
  '.get + $select',
  '.get + id + query',
  '.get + NotFound',
  '.get + id + query id',
  '.find',
  '.find + paginate + query',
  '.remove',
  '.remove + $select',
  '.remove + id + query',
  '.remove + id + query id',
  '.remove + NotFound',
  '.update',
  '.update + $select',
  '.update + id + query',
  '.update + NotFound',
  '.update + id + query id',
  '.update + query + NotFound',
  '.patch',
  '.patch + $select',
  '.patch + id + query',
  '.patch + query + NotFound',
  '.patch + NotFound',
  '.patch + id + query id',
  '.create',
  '.create ignores query',
  '.create + $select',
  '.create multi',
  'internal .find',
  'internal .get',
  'internal .create',
  'internal .update',
  'internal .patch',
  'internal .remove',
  '.find + equal',
  '.find + equal multiple',
  '.find + $sort',
  '.find + $sort + string',
  '.find + $limit',
  '.find + $limit 0',
  '.find + $skip',
  '.find + $select',
  '.find + $or',
  '.find + $and',
  '.find + $lt',
  '.find + $lte',
  '.find + $gt',
  '.find + $gte',
  '.find + $ne',
  '.find + $gt + $lt + $sort',
  '.find + $or nested + $sort',
  '.find + $and + $or',
  '.find + paginate',
  '.find + paginate + $limit + $skip',
  '.find + paginate + $limit 0',
  '.find + paginate + params',
  'params.adapter + paginate',

  // @TODO Comment why these are not implemented
  // NOT IMPLEMENTED
  // ".find + $in", // Redis-OM doesn't support $in https://github.com/redis/redis-om-node/issues/245
  // ".find + $nin", // Redis-OM doesn't support $nin https://github.com/redis/redis-om-node/issues/245
  // ".get + NotFound (integer)", // Don't need implement this now
  // ".remove + NotFound (integer)", // Don't need implement this now
  // ".remove + multi",  // Redis-OM doesn't support multi remove, we would have to do it in a loop
  // ".remove + multi no pagination", // Redis-OM doesn't support multi remove, we would have to do it in a loop
  // ".update + NotFound (integer)", // Don't need implement this now
  // ".patch multiple", // Redis-OM doesn't support multi patch, we would have to do it in a loop
  // ".patch multiple no pagination", // Redis-OM doesn't support multi patch, we would have to do it in a loop
  // ".patch multi query same", // Redis-OM doesn't support multi patch, we would have to do it in a loop
  // ".patch multi query changed", // Redis-OM doesn't support multi patch, we would have to do it in a loop
  // ".patch + NotFound (integer)", // Don't need implement this now
  // "params.adapter + multi" // Redis-OM doesn't support multi patch, we would have to do it in a loop
]);

describe('Feathers Redis Service', () => {
  const personSchema = {
    $id: 'Person',
    type: 'object',
    additionalProperties: false,
    required: ['uuid', 'name', 'age'],
    properties: {
      uuid: { type: 'string' },
      name: { type: 'string' },
      age: { type: 'number' },
      friends: { type: 'array', items: { type: 'string' } },
      team: { type: 'string' },
    },
  } as const;
  const personQuery = {
    $id: 'PersonQuery',
    type: 'object',
    additionalProperties: false,
    properties: {
      ...querySyntax(personSchema.properties, {
        name: {
          $regex: { type: 'string' },
        },
      }),
    },
  } as const;
  const validator = new Ajv({
    coerceTypes: true,
  });
  const personQueryValidator = getValidator(personQuery, validator);

  type Person = {
    uuid: number;
    name: string;
    age: number | null;
    friends: string[];
    team: string;
  };

  type ServiceTypes = {
    people: RedisService<Person>;
  };

  const app = feathers<ServiceTypes>();

  let redis: RedisConnection;
  before(async () => {
    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = parseInt(process.env.REDIS_PORT || '6379');
    console.log('Connecting to Redis at', process.env.REDIS_HOST, process.env.REDIS_PORT);
    redis = createClient({
      url: `redis://${host}:${port}`,
    });
    await redis.connect();
    app.use(
      'people',
      new RedisService({
        Model: redis,
        id: 'uuid',
        events: ['testing'],
        schema: new Schema('people', {
          uuid: { type: 'string' },
          name: { type: 'string' },
          age: { type: 'number' },
          friends: { type: 'string[]' },
        }),
      }),
    );

    app.service('people').hooks({
      before: {
        find: [hooks.validateQuery(personQueryValidator)],
      },
    });
  });

  afterEach(async () => {
    // @ts-ignore - Redis doesn't have a clear method
    await redis.sendCommand(['FLUSHALL']);
    await app.service('people').repository.createIndex();
  });

  after(async () => {
    await redis.quit();
  });

  testSuite(app, errors, 'people', 'uuid');
});
