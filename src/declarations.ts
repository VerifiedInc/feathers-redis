import { type RedisConnection, type Schema } from 'redis-om';
import {
  type AdapterServiceOptions,
  type AdapterParams,
  type AdapterQuery,
} from '@feathersjs/adapter-commons';
export interface RedisAdapterOptions extends AdapterServiceOptions {
  Model: RedisConnection;
  schema?: Schema;
}

export interface RedisAdapterParams<Q = AdapterQuery>
  extends AdapterParams<Q, Partial<RedisAdapterOptions>> {}
