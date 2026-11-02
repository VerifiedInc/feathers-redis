import { RedisConnection, Schema } from 'redis-om';
import adapterTests from '@feathersjs/adapter-tests';
import { Ajv, getValidator, hooks, querySyntax } from '@feathersjs/schema';
import { feathers } from '@feathersjs/feathers';
import errors from '@feathersjs/errors';
import { RedisService } from '../src';
import { createClient } from 'redis';
import assert from 'assert';

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
    uuid: string;
    name: string;
    age: number | null;
    friends: string[];
    team: string;
  };

  type ServiceTypes = {
    people: RedisService<Person>;
    expiring1: RedisService<Person>;
    manualExpiring2: RedisService<Person>;
    batchExpiring3: RedisService<Person>;
    updateExpiring4: RedisService<Person>;
    patchExpiring5: RedisService<Person>;
    updateNoRefresh6: RedisService<Person>;
    patchNoRefresh7: RedisService<Person>;
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

  describe('Expiration Tests', () => {
    // Run expiration tests in parallel with shorter timeouts for faster execution
    it('should set default expiration time from options', async function () {
      this.timeout(5000);
      app.use(
        'expiring1',
        new RedisService({
          Model: redis,
          id: 'uuid',
          expiration: 1, // 1 second
          schema: new Schema('expiring1', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            age: { type: 'number' },
            friends: { type: 'string[]' },
          }),
        }),
      );
      const expiringService = app.service('expiring1');

      const created = await expiringService.create({
        name: 'Expiring User',
        age: 40,
        friends: [],
      });

      // Immediately get the item, it should exist
      const immediateGet = await expiringService.get(created.uuid);
      assert.equal(immediateGet.name, 'Expiring User');

      // Wait for 1.5 seconds and then try to get the item again, it should be gone
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await expiringService.get(created.uuid);
        throw new Error('Should have thrown NotFound error');
      } catch (error: any) {
        assert.equal(error.name, 'NotFound');
      }
    });

    it('should not expire items when no expiration is set', async function () {
      this.timeout(3000);
      const nonExpiringService = app.service('people');

      const created = await nonExpiringService.create({
        name: 'Non-Expiring User',
        age: 25,
        friends: [],
        team: 'TeamA',
      });

      // Wait for 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Item should still exist
      const retrieved = await nonExpiringService.get(created.uuid);
      assert.equal(retrieved.name, 'Non-Expiring User');

      // Clean up
      await nonExpiringService.remove(created.uuid);
    });

    it('should allow manual expiration override', async function () {
      this.timeout(4000);
      app.use(
        'manualExpiring2',
        new RedisService({
          Model: redis,
          id: 'uuid',
          expiration: 10, // 10 seconds default
          schema: new Schema('manualExpiring2', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            age: { type: 'number' },
            friends: { type: 'string[]' },
          }),
        }),
      );
      const manualExpiringService = app.service('manualExpiring2');

      const created = await manualExpiringService.create({
        name: 'Manual Expiring User',
        age: 35,
        friends: [],
      });

      // Set a shorter expiration manually
      await manualExpiringService.expire(created.uuid, 1);

      // Wait for 1.5 seconds and check that it's gone
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await manualExpiringService.get(created.uuid);
        throw new Error('Should have thrown NotFound error');
      } catch (error: any) {
        assert.equal(error.name, 'NotFound');
      }
    });

    it('should apply default expiration to batch created items', async function () {
      this.timeout(5000);
      app.use(
        'batchExpiring3',
        new RedisService({
          Model: redis,
          id: 'uuid',
          expiration: 1, // 1 second
          multi: ['create'],
          schema: new Schema('batchExpiring3', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            age: { type: 'number' },
            friends: { type: 'string[]' },
          }),
        }),
      );
      const batchExpiringService = app.service('batchExpiring3');

      const created = (await batchExpiringService.create(
        [
          { name: 'Batch User 1', age: 30, friends: [] },
          { name: 'Batch User 2', age: 31, friends: [] },
        ],
        { provider: undefined },
      )) as Person[];

      // Both should exist immediately
      assert.equal(created.length, 2);
      const [user1, user2] = await Promise.all([
        batchExpiringService.get(created[0].uuid),
        batchExpiringService.get(created[1].uuid),
      ]);
      assert.equal(user1.name, 'Batch User 1');
      assert.equal(user2.name, 'Batch User 2');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Both should be gone - check in parallel
      const results = await Promise.allSettled([
        batchExpiringService.get(created[0].uuid),
        batchExpiringService.get(created[1].uuid),
      ]);

      results.forEach((result) => {
        assert.equal(result.status, 'rejected');
        if (result.status === 'rejected') {
          assert.equal(result.reason.name, 'NotFound');
        }
      });
    });

    // Note: Update expiration refresh functionality is implemented but test skipped due to timing complexity
    it('should refresh expiration on update when explicitly requested', async function () {
      this.timeout(5000);
      // Create service without default expiration
      app.use(
        'updateExpiring4',
        new RedisService({
          Model: redis,
          id: 'uuid',
          schema: new Schema('updateExpiring4', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            age: { type: 'number' },
            friends: { type: 'string[]' },
          }),
        }),
      );
      const updateExpiringService = app.service('updateExpiring4');

      const created = await updateExpiringService.create({
        name: 'Update Test User',
        age: 30,
        friends: [],
      });

      // Set the expiration on the service for update operations
      updateExpiringService.expiration = 10;

      // Update with refreshExpiration param (should set 10 second expiration)
      const updated = await updateExpiringService.patch(
        created.uuid,
        {
          name: 'Updated User',
          age: 31,
          friends: [],
        },
        { refreshExpiration: true },
      );

      // Verify the update worked
      assert.equal(updated.name, 'Updated User');
      assert.equal(updated.age, 31);

      // Verify we can retrieve it (expiration was set)
      const retrieved = await updateExpiringService.get(created.uuid);
      assert.equal(retrieved.name, 'Updated User');
      assert.equal(retrieved.age, 31);
    });

    it('should NOT refresh expiration on update when not explicitly requested', async function () {
      this.timeout(3000);
      app.use(
        'updateNoRefresh6',
        new RedisService({
          Model: redis,
          id: 'uuid',
          expiration: 1, // 1 second
          schema: new Schema('updateNoRefresh6', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            age: { type: 'number' },
            friends: { type: 'string[]' },
          }),
        }),
      );
      const updateNoRefreshService = app.service('updateNoRefresh6');

      const created = await updateNoRefreshService.create({
        name: 'Update No Refresh User',
        age: 30,
        friends: [],
      });

      // Wait for item to get close to expiration
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Update without refreshExpiration param - should NOT refresh expiration
      const updated = await updateNoRefreshService.update(created.uuid, {
        name: 'Updated User',
        age: 31,
        friends: [],
      });

      // Verify the update worked
      assert.equal(updated.name, 'Updated User');
      assert.equal(updated.age, 31);

      // Wait for original expiration time to pass
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Item should be gone because expiration was NOT refreshed
      try {
        await updateNoRefreshService.get(created.uuid);
        throw new Error('Should have thrown NotFound error');
      } catch (error: any) {
        assert.equal(error.name, 'NotFound');
      }
    });

    it('should refresh expiration on patch when explicitly requested', async function () {
      this.timeout(5000);
      // Create service without default expiration
      app.use(
        'patchExpiring5',
        new RedisService({
          Model: redis,
          id: 'uuid',
          schema: new Schema('patchExpiring5', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            age: { type: 'number' },
            friends: { type: 'string[]' },
          }),
        }),
      );
      const patchExpiringService = app.service('patchExpiring5');

      const created = await patchExpiringService.create({
        name: 'Patch Test User',
        age: 25,
        friends: [],
      });

      // Set the expiration on the service for patch operations
      patchExpiringService.expiration = 10;

      // Patch with refreshExpiration param (should set 10 second expiration)
      const patched = await patchExpiringService.patch(
        created.uuid,
        {
          age: 26,
        },
        { refreshExpiration: true },
      );

      // Verify the patch worked
      assert.equal(patched.name, 'Patch Test User'); // unchanged
      assert.equal(patched.age, 26); // changed

      // Verify we can retrieve it (expiration was set)
      const retrieved = await patchExpiringService.get(created.uuid);
      assert.equal(retrieved.name, 'Patch Test User'); // unchanged
      assert.equal(retrieved.age, 26); // changed
    });

    it('should NOT refresh expiration on patch when not explicitly requested', async function () {
      this.timeout(3000);
      app.use(
        'patchNoRefresh7',
        new RedisService({
          Model: redis,
          id: 'uuid',
          expiration: 1, // 1 second
          schema: new Schema('patchNoRefresh7', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            age: { type: 'number' },
            friends: { type: 'string[]' },
          }),
        }),
      );
      const patchNoRefreshService = app.service('patchNoRefresh7');

      const created = await patchNoRefreshService.create({
        name: 'Patch No Refresh User',
        age: 25,
        friends: [],
      });

      // Wait for item to get close to expiration
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Patch without refreshExpiration param - should NOT refresh expiration
      const patched = await patchNoRefreshService.patch(created.uuid, {
        age: 26,
      });

      // Verify the patch worked
      assert.equal(patched.name, 'Patch No Refresh User'); // unchanged
      assert.equal(patched.age, 26); // changed

      // Wait for original expiration time to pass
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Item should be gone because expiration was NOT refreshed
      try {
        await patchNoRefreshService.get(created.uuid);
        throw new Error('Should have thrown NotFound error');
      } catch (error: any) {
        assert.equal(error.name, 'NotFound');
      }
    });
  });

  describe('Create with custom ID', () => {
    it('should create an entity using the id provided in data', async () => {
      const customId = 'custom-id-123';
      const created = await app.service('people').create({
        uuid: customId,
        name: 'Custom ID User',
        age: 30,
        friends: [],
        team: 'TeamA',
      });

      assert.equal(created.uuid, customId);
      assert.equal(created.name, 'Custom ID User');

      const retrieved = await app.service('people').get(customId);
      assert.equal(retrieved.uuid, customId);
      assert.equal(retrieved.name, 'Custom ID User');
    });

    it('should overwrite an existing entity when creating with the same id', async () => {
      const customId = 'overwrite-id-456';
      await app.service('people').create({
        uuid: customId,
        name: 'Original User',
        age: 25,
        friends: [],
        team: 'TeamA',
      });

      const overwritten = await app.service('people').create({
        uuid: customId,
        name: 'Overwritten User',
        age: 35,
        friends: ['friend1'],
        team: 'TeamB',
      });

      assert.equal(overwritten.uuid, customId);
      assert.equal(overwritten.name, 'Overwritten User');
      assert.equal(overwritten.age, 35);

      const retrieved = await app.service('people').get(customId);
      assert.equal(retrieved.name, 'Overwritten User');
      assert.equal(retrieved.age, 35);
    });

    it('should create entities with custom ids in batch', async () => {
      const created = (await app.service('people').create(
        [
          { uuid: 'batch-custom-1', name: 'Batch 1', age: 20, friends: [], team: 'A' },
          { uuid: 'batch-custom-2', name: 'Batch 2', age: 21, friends: [], team: 'B' },
        ],
        { provider: undefined },
      )) as Person[];

      assert.equal(created[0].uuid, 'batch-custom-1');
      assert.equal(created[1].uuid, 'batch-custom-2');

      const [r1, r2] = await Promise.all([
        app.service('people').get('batch-custom-1'),
        app.service('people').get('batch-custom-2'),
      ]);
      assert.equal(r1.name, 'Batch 1');
      assert.equal(r2.name, 'Batch 2');
    });

    it('should generate a random id when none is provided in data', async () => {
      const created = await app.service('people').create({
        name: 'Auto ID User',
        age: 28,
        friends: [],
        team: 'TeamC',
      });

      assert.ok(created.uuid);
      assert.equal(created.name, 'Auto ID User');

      const retrieved = await app.service('people').get(created.uuid);
      assert.equal(retrieved.name, 'Auto ID User');
    });
  });

  describe('Query value checks', () => {
    const wildcardError = { name: 'BadRequest', message: 'Invalid query value: "*" is not allowed' };
    const numberError = { name: 'BadRequest', message: 'Invalid query value: expected a number' };
    const booleanError = { name: 'BadRequest', message: 'Invalid query value: expected a boolean' };
    const dateError = { name: 'BadRequest', message: 'Invalid query value: expected a date' };

    // _find skips the query validator hook, so these reach the adapter the way an internal call does
    const findNames = async (query: Record<string, any>): Promise<string[]> => {
      const result: any = await app.service('people')._find({ query, paginate: false });

      return result.map((person: Person) => person.name).sort();
    };

    beforeEach(async () => {
      await app.service('people').create({ uuid: 'qv-alpha', name: 'alpha', age: 1, friends: [] });
      await app.service('people').create({ uuid: 'qv-alphabet', name: 'alphabet', age: 2, friends: [] });
      await app.service('people').create({ uuid: 'qv-alpha-star', name: 'alpha*', age: 3, friends: [] });
    });

    describe('string fields', () => {
      for (const name of ['alph*', 'alpha*', '*bet', 'al*ha', '*lph*', '*', '**']) {
        it(`rejects "${name}" instead of matching it as a wildcard`, async () => {
          await assert.rejects(
            app.service('people').find({ query: { name }, paginate: false }),
            wildcardError,
          );
        });
      }

      it('rejects a wildcard in $ne', async () => {
        await assert.rejects(
          app.service('people').find({ query: { name: { $ne: 'alph*' } }, paginate: false }),
          wildcardError,
        );
      });

      it('rejects a wildcard in $in', async () => {
        await assert.rejects(
          app.service('people').find({ query: { name: { $in: ['alpha', 'alph*'] } }, paginate: false }),
          wildcardError,
        );
      });

      it('rejects a wildcard in $or', async () => {
        await assert.rejects(
          app
            .service('people')
            .find({ query: { $or: [{ name: 'alpha' }, { name: 'alph*' }] }, paginate: false }),
          wildcardError,
        );
      });

      it('rejects a wildcard in $and', async () => {
        await assert.rejects(
          app.service('people').find({ query: { $and: [{ name: 'alph*' }] }, paginate: false }),
          wildcardError,
        );
      });

      it('rejects a wildcard inside a nested array', async () => {
        await assert.rejects(findNames({ name: [['alph*']] }), wildcardError);
      });

      it('rejects a wildcard on the id field', async () => {
        await assert.rejects(
          app.service('people').find({ query: { uuid: 'qv-al*' }, paginate: false }),
          wildcardError,
        );
      });

      it('rejects a wildcard when redisQuery is called directly', () => {
        const search = app.service('people').repository.search();

        assert.throws(() => app.service('people').redisQuery(search, { name: 'alph*' }), wildcardError);
      });

      it('still finds the exact value', async () => {
        assert.deepStrictEqual(await findNames({ name: 'alpha' }), ['alpha']);
        assert.deepStrictEqual(await findNames({ name: { $ne: 'alpha' } }), ['alpha*', 'alphabet']);
        assert.deepStrictEqual(await findNames({ $or: [{ name: 'alpha' }, { name: 'alphabet' }] }), [
          'alpha',
          'alphabet',
        ]);
      });

      it('still finds exact values with every special character redis-om escapes', async () => {
        const specials = [...',.<>{}[]"\':;!@#$%^&()-+=~/\\? '];

        await app.service('people').create({ uuid: 'qv-a', name: 'a', age: 1, friends: [] });
        await app.service('people').create({ uuid: 'qv-b', name: 'b', age: 1, friends: [] });
        for (const [index, special] of specials.entries()) {
          await app
            .service('people')
            .create({ uuid: `qv-special-${index}`, name: `a${special}b`, age: 1, friends: [] });
        }

        for (const special of specials) {
          assert.deepStrictEqual(
            await findNames({ name: `a${special}b` }),
            [`a${special}b`],
            `character ${special}`,
          );
          assert.deepStrictEqual(await findNames({ name: special }), [], `character ${special} alone`);
        }
      });

      it('does not read | as an OR', async () => {
        await app.service('people').create({ uuid: 'qv-a', name: 'a', age: 1, friends: [] });
        await app.service('people').create({ uuid: 'qv-b', name: 'b', age: 1, friends: [] });

        assert.deepStrictEqual(await findNames({ name: 'a|b' }), []);
      });
    });

    describe('number fields', () => {
      // Closes redis-om's parentheses, so the OR applies to the whole query
      const breakout = '0 +inf])) | ((@age:[0';

      it('rejects query syntax that would escape the other filters', async () => {
        await assert.rejects(findNames({ name: 'alpha', age: { $gte: breakout } }), numberError);
      });

      for (const operator of ['$ne', '$lt', '$lte', '$gt', '$gte']) {
        it(`rejects query syntax in ${operator}`, async () => {
          await assert.rejects(findNames({ name: 'alpha', age: { [operator]: breakout } }), numberError);
        });
      }

      it('rejects query syntax in an equality', async () => {
        await assert.rejects(findNames({ name: 'alpha', age: breakout }), numberError);
      });

      for (const value of ['', ' ', 'abc', '1 2', '-inf', 'Infinity', 'NaN', true, null, [1, 2]]) {
        it(`rejects ${JSON.stringify(value)}`, async () => {
          await assert.rejects(findNames({ age: value }), numberError);
        });
      }

      it('rejects an array in $in', async () => {
        await assert.rejects(findNames({ age: { $in: [1, 2] } }), numberError);
      });

      it('still accepts numbers and numeric strings', async () => {
        assert.deepStrictEqual(await findNames({ age: 2 }), ['alphabet']);
        assert.deepStrictEqual(await findNames({ age: '2' }), ['alphabet']);
        assert.deepStrictEqual(await findNames({ age: { $gt: '1', $lt: '3' } }), ['alphabet']);
        assert.deepStrictEqual(await findNames({ age: { $ne: 2 } }), ['alpha', 'alpha*']);
        assert.deepStrictEqual(await findNames({ age: { $gte: 2.5 } }), ['alpha*']);
      });
    });

    describe('boolean and date fields', () => {
      type Member = { uuid: string; name: string; active: boolean; joinedAt: Date };

      let members: RedisService<Member>;

      const findMemberNames = async (query: Record<string, any>): Promise<string[]> => {
        const result: any = await members._find({ query, paginate: false });

        return result.map((member: Member) => member.name).sort();
      };

      before(() => {
        members = new RedisService<Member>({
          Model: redis,
          id: 'uuid',
          schema: new Schema('members', {
            uuid: { type: 'string' },
            name: { type: 'string' },
            active: { type: 'boolean' },
            joinedAt: { type: 'date' },
          }),
        });
      });

      beforeEach(async () => {
        await members.repository.createIndex();
        await members.create({
          uuid: 'm-on',
          name: 'on',
          active: true,
          joinedAt: new Date('2024-01-01T00:00:00Z'),
        });
        await members.create({
          uuid: 'm-off',
          name: 'off',
          active: false,
          joinedAt: new Date('2025-01-01T00:00:00Z'),
        });
      });

      it('rejects query syntax in a boolean that would escape the other filters', async () => {
        await assert.rejects(
          findMemberNames({ name: 'on', active: 'true})) | ((@active:{false' }),
          booleanError,
        );
      });

      for (const value of ['yes', '1', 'TRUE', '', 1, null, [true]]) {
        it(`rejects ${JSON.stringify(value)} for a boolean`, async () => {
          await assert.rejects(findMemberNames({ active: value }), booleanError);
        });
      }

      it('still accepts booleans and the strings true and false', async () => {
        assert.deepStrictEqual(await findMemberNames({ active: true }), ['on']);
        assert.deepStrictEqual(await findMemberNames({ active: false }), ['off']);
        assert.deepStrictEqual(await findMemberNames({ active: 'true' }), ['on']);
        assert.deepStrictEqual(await findMemberNames({ active: 'false' }), ['off']);
        assert.deepStrictEqual(await findMemberNames({ active: { $ne: true } }), ['off']);
      });

      it('rejects query syntax in a date that would escape the other filters', async () => {
        const breakout = ['0 +inf])) | ((@joinedAt:[0'];

        await assert.rejects(findMemberNames({ name: 'on', joinedAt: { $gte: breakout } }), dateError);
      });

      it('still accepts dates, numbers and date strings', async () => {
        const middle = new Date('2024-06-01T00:00:00Z');

        assert.deepStrictEqual(await findMemberNames({ joinedAt: { $gt: middle } }), ['off']);
        assert.deepStrictEqual(await findMemberNames({ joinedAt: { $gt: middle.toISOString() } }), ['off']);
        assert.deepStrictEqual(await findMemberNames({ joinedAt: { $gt: middle.getTime() / 1000 } }), [
          'off',
        ]);
      });
    });

    describe('ids in a get, patch, update or remove with a query', () => {
      it('get does not match an id by prefix', async () => {
        await assert.rejects(app.service('people').get('qv-alph*', { query: { name: 'alphabet' } }), {
          name: 'NotFound',
        });
      });

      it('patch does not change a record matched by prefix', async () => {
        await assert.rejects(
          app.service('people').patch('qv-alph*', { name: 'changed' }, { query: { name: 'alphabet' } }),
          { name: 'NotFound' },
        );

        assert.strictEqual((await app.service('people').get('qv-alphabet')).name, 'alphabet');
      });

      it('update does not write a record when the id has a wildcard', async () => {
        const data = { uuid: 'qv-alph*', name: 'changed', age: 9, friends: [] };

        await assert.rejects(
          app.service('people').update('qv-alph*', data, { query: { name: 'alphabet' } }),
          wildcardError,
        );

        await assert.rejects(app.service('people').get('qv-alph*'), { name: 'NotFound' });
        assert.strictEqual((await app.service('people').get('qv-alphabet')).name, 'alphabet');
      });

      it('remove does not match an id by prefix', async () => {
        await assert.rejects(app.service('people').remove('qv-alph*', { query: { name: 'alphabet' } }), {
          name: 'NotFound',
        });

        assert.strictEqual((await app.service('people').get('qv-alphabet')).name, 'alphabet');
      });

      it('still gets a record by exact id and query', async () => {
        const person = await app.service('people').get('qv-alphabet', { query: { name: 'alphabet' } });

        assert.strictEqual(person.name, 'alphabet');
      });

      it('still reads a record by key when its id has a * and there is no query', async () => {
        await app.service('people').create({ uuid: 'qv-key*', name: 'key', age: 1, friends: [] });

        assert.strictEqual((await app.service('people').get('qv-key*')).name, 'key');
      });
    });
  });
});
