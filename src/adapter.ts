import { type Entity, Repository, type EntityInternal, type Search, RedisOmError } from 'redis-om';
import {
  AdapterBase,
  type PaginationOptions,
  type AdapterQuery,
  getLimit,
} from '@feathersjs/adapter-commons';
import { BadRequest, MethodNotAllowed, NotFound } from '@feathersjs/errors';
import { type PaginationParams, type Id, type NullableId, type Paginated } from '@feathersjs/feathers';
import { randomUUID } from 'crypto';
import { type RedisAdapterOptions, type RedisAdapterParams } from './declarations';
import { errorHandler } from './error-handler';

const METHODS = {
  $ne: 'not',
  $in: '', // Redis-OM does not support $in queries directly (workaround needed for this, e.g. using $or)
  $nin: '', // Redis-OM does not support $nin queries directly (workaround needed for this, e.g. using $and)
  $or: 'or',
  $and: 'and',
  $lt: 'lt',
  $lte: 'lte',
  $gt: 'gt',
  $gte: 'gte',
};

/**
 * RedisAdapter class extends the AdapterBase class to provide a Redis-based
 * implementation for FeathersJS services.
 *
 * @template Result - The type of the result entity.
 * @template Data - The type of the data for creating/updating entities.
 * @template ServiceParams - The type of the service parameters.
 * @template PatchData - The type of the data for patching entities.
 */
export class RedisAdapter<
  Result extends Entity,
  Data = Partial<Result>,
  ServiceParams extends RedisAdapterParams<any> = RedisAdapterParams,
  PatchData = Partial<Data>,
> extends AdapterBase<Result, Data, PatchData, ServiceParams, RedisAdapterOptions> {
  repository: Repository<Result>;
  expiration: number | undefined;

  /**
   * Constructor for the RedisAdapter class.
   *
   * @param options - The options for the Redis adapter, including the Redis client and schema.
   * @throws {Error} If the options, Model, or schema are not provided.
   */
  constructor(options: RedisAdapterOptions) {
    if (!options || !options.Model || !options.schema) {
      throw new Error('You must provide a Redis client and schema');
    }

    super({
      id: options.id ?? 'entityId',
      ...options,
    });

    this.repository = new Repository<Result>(options.schema, options.Model);

    // Set expiration time if provided in options
    this.expiration = options.expiration;

    // If you change your schema, no worries. Redis OM will automatically rebuild the index for you.
    // Just call .createIndex again. And don't worry if you call .createIndex when your schema hasn't changed.
    // Redis OM will only rebuild your index if the schema has changed. So, you can safely use it in your startup code.
    void this.repository.createIndex();
  }

  /**
   * Function to set the expiration time for a key in Redis.
   *
   * @param key - The key to set the expiration time for.
   * @param seconds - The number of seconds to set the expiration time for.
   * @returns A promise that resolves when the expiration time is set.
   */
  async expire(key: string, seconds: number): Promise<void>;
  async expire(key: Result, seconds: number): Promise<void>;
  async expire(key: string | Result, seconds: number): Promise<void> {
    if (typeof key === 'object') {
      key = key[this.id] as string;
    }
    await this.repository.expire(key, seconds);
  }

  /**
   * Function to create redis-om queries based on the FeathersJS query object.
   *
   * @param search - The Redis OM search instance.
   * @param query - The FeathersJS query object.
   * @param parentKey - The parent key for nested queries.
   * @returns The modified search instance.
   */
  redisQuery(search: Search<Result>, query: AdapterQuery, parentKey?: string): any {
    try {
      for (const key in query) {
        const value = query[key];

        const column = parentKey ?? key;

        if (key === '$or') {
          value.forEach((item: AdapterQuery) => {
            search.or((subSearch) => {
              this.redisQuery(subSearch, item);
              return subSearch;
            });
          });
        } else if (key === '$and') {
          search.and((subSearch) => {
            value.forEach((item: AdapterQuery) => {
              this.redisQuery(subSearch, item);
            });

            return subSearch;
          });
        } else if (key === '$sort') {
          Object.keys(value as Record<string, any>).forEach((sortKey) => {
            search.sortBy(
              sortKey as Exclude<keyof Result, keyof EntityInternal>,
              value[sortKey] === 1 ? 'ASC' : 'DESC',
            );
          });
        } else if (
          !(value instanceof Date) &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          value !== null
        ) {
          this.redisQuery(search, value, key);
        } else {
          const method = METHODS[key as keyof typeof METHODS];
          // Check if the key is one of the feathers query methods ($ne, $in, $nin, $lt, $lte, $gt, $gte) except $or and $and which are handled above
          if (method) {
            /**
             * If the method is $ne, we need to use the `.not.equals` method and trying to use [method] will throw an error.
             */
            if (method === METHODS.$ne) {
              search.where(column as Exclude<keyof Result, keyof EntityInternal>).not.equals(value);
            } else {
              (search.where(column as Exclude<keyof Result, keyof EntityInternal>) as any)[method](value);
            }
          } else {
            // If the method is not in the METHODS object, use the method as equals
            search.where(column as Exclude<keyof Result, keyof EntityInternal>).equals(value);
          }
        }
      }
    } catch (error) {
      if (error instanceof RedisOmError) {
        throw errorHandler(error);
      }
      throw error;
    }
  }

  /**
   * Filters the query parameters to extract pagination and sorting options.
   *
   * @param params - The service parameters.
   * @returns An object containing pagination, filters, and the query.
   */
  filterQuery(params: ServiceParams): {
    paginate?: PaginationParams;
    filters: { $select?: string[]; $sort?: Record<string, any>; $limit: number; $skip: number };
    query: AdapterQuery;
  } {
    const options = this.getOptions(params);
    const { $select, $sort, $limit: _limit, $skip = 0, ...query } = (params.query || {}) as AdapterQuery;
    const $limit = getLimit(_limit, options.paginate);

    return {
      paginate: options.paginate,
      filters: { $select, $sort, $limit, $skip },
      query,
    };
  }

  /**
   * Finds entities based on the provided parameters.
   *
   * @param params - The service parameters, including pagination options.
   * @returns A promise that resolves to the found entities or paginated results.
   */
  async _find(params?: ServiceParams & { paginate?: PaginationOptions }): Promise<Paginated<Result>>;
  async _find(params?: ServiceParams & { paginate: false }): Promise<Result[]>;
  async _find(params?: ServiceParams): Promise<Paginated<Result> | Result[]>;
  async _find(params: ServiceParams = {} as ServiceParams): Promise<Paginated<Result> | Result[]> {
    try {
      const { filters, paginate, query } = this.filterQuery(params);
      const { id: idField } = this.getOptions(params);

      const paginationDisabled = params.paginate === false || !paginate || !paginate.default;

      const search = this.repository.search();

      if (query && Object.keys(query).length > 0) {
        this.redisQuery(search, query);
      }

      if (params.query.$sort) {
        Object.keys(params.query.$sort).forEach((key) => {
          search.sortBy(
            key as Exclude<keyof Result, keyof EntityInternal>,
            params.query.$sort[key] === 1 ? 'ASC' : 'DESC',
          );
        });
      }

      // If pagination is not provided, return all matching results
      let results: Result[];

      if (paginationDisabled) {
        if (filters.$limit && !filters.$skip) {
          // if $limit is provider but $skip is not, return the first $limit results
          results = await search.page(0, filters.$limit);
        } else if (filters.$limit && filters.$skip) {
          // if $limit is provider and $skip is provided, return the next $limit results, round up
          results = await search.page(filters.$skip, filters.$limit);
        } else if (!filters.$limit && filters.$skip) {
          // if $limit is not provided and $skip is provided, return $skip results
          results = await search.page(filters.$skip, await search.count());
        } else if (filters.$limit === 0) {
          return [];
        } else {
          // if $limit is not provided, return all results
          results = await search.return.all();
        }
        if (filters.$select) {
          // Keep only the $select fields
          results.forEach((entity) => {
            const keys = Object.keys(entity);
            for (const key of keys) {
              if (filters.$select && !filters.$select.includes(key) && key !== idField) {
                delete entity[key];
              }
            }
          });
        }

        return results;
      }
      results = await search.page(filters.$skip, filters.$limit);
      const total = await search.count();
      return {
        total,
        limit: filters.$limit,
        skip: filters.$skip,
        data: results,
      };
    } catch (error) {
      if (error instanceof RedisOmError) {
        throw errorHandler(error);
      }
      throw error;
    }
  }

  /**
   * Retrieves an entity by its ID.
   *
   * @param id - The ID of the entity to retrieve.
   * @param _params - The service parameters.
   * @returns A promise that resolves to the retrieved entity.
   * @throws {NotFound} If no record is found for the given ID.
   */
  async _get(id: Id, _params: ServiceParams = {} as ServiceParams): Promise<Result> {
    try {
      const { id: idField } = this.getOptions(_params);
      const { filters, query } = this.filterQuery(_params);
      let entity: Result;

      if (query && Object.keys(query).length > 0) {
        const search = this.repository.search();
        this.redisQuery(search, query);
        search.and(idField as Exclude<keyof Result, keyof EntityInternal>).eq(id);
        const results = await search.return.all();
        if (results.length === 0) {
          throw new NotFound(`No record found for id '${id}'`);
        }

        entity = results[0];
      } else {
        entity = await this.repository.fetch(id as string);
      }

      // It does this because Redis doesn't distinguish between missing and null.
      if (idField && !entity[idField]) {
        throw new NotFound(`No record found for id '${id}'`);
      }
      if (filters.$select) {
        // Keep only the $select fields
        const keys = Object.keys(entity);
        for (const key of keys) {
          if (!filters.$select.includes(key) && key !== idField) {
            delete entity[key];
          }
        }
      }
      return entity;
    } catch (error) {
      throw new NotFound(`No record found for id '${id}'`);
    }
  }

  /**
   * Creates a new entity or entities.
   *
   * @param data - The data for the new entity or entities.
   * @param _params - The service parameters.
   * @returns A promise that resolves to the created entity or entities.
   */
  async _create(data: Data, _params?: ServiceParams): Promise<Result>;
  async _create(data: Data[], _params?: ServiceParams): Promise<Result[]>;
  async _create(
    data: Data | Data[],
    _params: ServiceParams = {} as ServiceParams,
  ): Promise<Result | Result[]> {
    try {
      const { id: idField } = this.getOptions(_params);
      const { filters } = this.filterQuery(_params);
      if (Array.isArray(data)) {
        const results = await Promise.all(
          data.map(async (item: Data) => {
            const uuid = randomUUID();
            return await this.repository.save(uuid, {
              [idField ?? 'entityId']: uuid,
              ...item,
            } as unknown as Result);
          }),
        );
        if (filters.$select) {
          // Keep only the $select fields
          results.forEach((entity) => {
            const keys = Object.keys(entity);
            for (const key of keys) {
              if (filters.$select && !filters.$select.includes(key) && key !== idField) {
                delete entity[key];
              }
            }
          });
        }
        return results;
      }
      const uuid = randomUUID();
      const entity = await this.repository.save(uuid, {
        [idField ?? 'entityId']: uuid,
        ...data,
      } as unknown as Result);

      if (filters.$select) {
        // Keep only the $select fields - Redis-OM does not support this natively
        const keys = Object.keys(entity);
        for (const key of keys) {
          if (!filters.$select.includes(key) && key !== idField) {
            delete entity[key];
          }
        }
      }
      // Set expiration if defined in options
      if (this.expiration) {
        await this.expire(entity, this.expiration);
      }
      return entity;
    } catch (error) {
      if (error instanceof RedisOmError) {
        throw errorHandler(error);
      }
      throw error;
    }
  }

  /**
   * Patches an existing entity by its ID.
   *
   * @param id - The ID of the entity to patch.
   * @param data - The data to patch the entity with.
   * @param params - The service parameters.
   * @returns A promise that resolves to the patched entity or entities.
   * @throws {MethodNotAllowed} If attempting to patch multiple entries without an ID.
   */
  async _patch(id: null, data: PatchData | Partial<Result>, params?: ServiceParams): Promise<Result[]>;
  async _patch(id: Id, data: PatchData | Partial<Result>, params?: ServiceParams): Promise<Result>;
  async _patch(
    id: NullableId,
    data: PatchData | Partial<Result>,
    _params?: ServiceParams,
  ): Promise<Result | Result[]>;
  async _patch(
    id: NullableId,
    data: PatchData | Partial<Result>,
    params: ServiceParams = {} as ServiceParams,
  ): Promise<Result | Result[]> {
    try {
      if (id === null) {
        throw new MethodNotAllowed('Cannot patch multiple entries without an ID');
      }

      const entity = await this._get(id, params);
      Object.assign(entity, data);
      await this.repository.save(entity);
      return entity;
    } catch (error) {
      if (error instanceof RedisOmError) {
        throw errorHandler(error);
      }
      throw error;
    }
  }

  /**
   * Updates an existing entity by its ID.
   *
   * @param id - The ID of the entity to update.
   * @param data - The data to update the entity with.
   * @param _params - The service parameters.
   * @returns A promise that resolves to the updated entity.
   * @throws {BadRequest} If no ID is provided.
   * @throws {NotFound} If no record is found for the given ID.
   */
  async _update(id: string, data: Data, _params: ServiceParams = {} as ServiceParams): Promise<Result> {
    try {
      if (id === null) {
        throw new BadRequest('You must provide an ID to update an entry');
      }

      const { id: idField } = this.getOptions(_params);
      const { filters, query } = this.filterQuery(_params);
      let entity: Result;

      if (query && Object.keys(query).length > 0) {
        const search = this.repository.search();
        this.redisQuery(search, query);
        search.and(idField as Exclude<keyof Result, keyof EntityInternal>).eq(id);
        const results = await search.return.all();
        if (results.length === 0) {
          throw new NotFound(`No record found for id '${id}'`);
        }

        entity = results[0];
      } else {
        entity = await this.repository.fetch(id);
        if (idField && !entity[idField]) {
          throw new NotFound(`No record found for id '${id}'`);
        }
      }

      entity = await this.repository.save(id, data as unknown as Result);
      if (filters.$select) {
        // Keep only the $select fields
        const keys = Object.keys(entity);
        for (const key of keys) {
          if (!filters.$select.includes(key) && key !== idField) {
            delete entity[key];
          }
        }
      }
      return entity;
    } catch (error) {
      if (error instanceof RedisOmError) {
        throw errorHandler(error);
      }
      throw error;
    }
  }

  /**
   * Removes an entity by its ID.
   *
   * @param id - The ID of the entity to remove.
   * @param params - The service parameters.
   * @returns A promise that resolves to the removed entity or entities.
   * @throws {MethodNotAllowed} If attempting to remove multiple entries without an ID.
   */
  async _remove(id: Id, params?: ServiceParams): Promise<Result>;
  async _remove(id: null, params?: ServiceParams): Promise<Result[]>;
  async _remove(id: NullableId, params?: ServiceParams): Promise<Result | Result[]>;
  async _remove(id: NullableId, params?: ServiceParams): Promise<Result | Result[]> {
    try {
      if (id === null) {
        throw new MethodNotAllowed('Cannot remove multiple entries without an ID');
      }

      const entity = await this._get(id, params);
      await this.repository.remove(id as string);
      return entity;
    } catch (error) {
      if (error instanceof RedisOmError) {
        throw errorHandler(error);
      }
      throw error;
    }
  }
}
