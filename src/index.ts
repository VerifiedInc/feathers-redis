import { type PaginationOptions } from '@feathersjs/adapter-commons';
import { MethodNotAllowed } from '@feathersjs/errors/lib';
import {
  type Paginated,
  type ServiceMethods,
  type Id,
  type NullableId,
  type Params,
} from '@feathersjs/feathers';
import { type RedisAdapterParams } from './declarations';
import { RedisAdapter } from './adapter';
import { type Entity } from 'redis-om';

export * from './declarations';
export * from './adapter';

export class RedisService<
    Result extends Entity,
    Data = Partial<Result>,
    ServiceParams extends Params<any> = RedisAdapterParams,
    PatchData = Partial<Data>,
  >
  extends RedisAdapter<Result, Data, ServiceParams, PatchData>
  implements ServiceMethods<Result | Paginated<Result>, Data, ServiceParams, PatchData>
{
  async find(params?: ServiceParams & { paginate?: PaginationOptions }): Promise<Paginated<Result>>;
  async find(params?: ServiceParams & { paginate: false }): Promise<Result[]>;
  async find(params?: ServiceParams): Promise<Paginated<Result> | Result[]>;
  async find(params?: ServiceParams): Promise<Paginated<Result> | Result[]> {
    const sanitizedParams = {
      ...params,
      query: await this.sanitizeQuery(params),
    } as ServiceParams;
    return await this._find(sanitizedParams);
  }

  async get(id: Id, params?: ServiceParams): Promise<Result> {
    const sanitizedParams = {
      ...params,
      query: await this.sanitizeQuery(params),
    } as ServiceParams;
    return await this._get(id, sanitizedParams);
  }

  async create(data: Data, params?: ServiceParams): Promise<Result>;
  async create(data: Data[], params?: ServiceParams): Promise<Result[]>;
  async create(data: Data | Data[], params?: ServiceParams): Promise<Result | Result[]>;
  async create(data: Data | Data[], params?: ServiceParams): Promise<Result | Result[]> {
    if (Array.isArray(data) && !this.allowsMulti('create', params)) {
      throw new MethodNotAllowed('Can not create multiple entries');
    }

    if (Array.isArray(data)) {
      return await this._create(data, params);
    } else {
      return await this._create(data, params);
    }
  }

  async update(id: string, data: Data, params?: ServiceParams): Promise<Result> {
    const sanitizedParams = {
      ...params,
      query: await this.sanitizeQuery(params),
    } as ServiceParams;
    return await this._update(id, data, sanitizedParams);
  }

  async patch(id: Id, data: PatchData, params?: ServiceParams): Promise<Result>;
  async patch(id: null, data: PatchData, params?: ServiceParams): Promise<Result[]>;
  async patch(id: NullableId, data: PatchData, params?: ServiceParams): Promise<Result | Result[]>;
  async patch(id: NullableId, data: PatchData, params?: ServiceParams): Promise<Result | Result[]> {
    const { $limit, ...query } = await this.sanitizeQuery(params);

    return await this._patch(id, data, {
      ...params,
      query,
    } as ServiceParams);
  }

  async remove(id: Id, params?: ServiceParams): Promise<Result>;
  async remove(id: null, params?: ServiceParams): Promise<Result[]>;
  async remove(id: NullableId, params?: ServiceParams): Promise<Result | Result[]>;
  async remove(id: NullableId, params?: ServiceParams): Promise<Result | Result[]> {
    const { $limit, ...query } = await this.sanitizeQuery(params);

    return await this._remove(id, {
      ...params,
      query,
    } as ServiceParams);
  }
}
