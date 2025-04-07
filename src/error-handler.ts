import { GeneralError } from '@feathersjs/errors';
import { type RedisOmError } from 'redis-om';

export function errorHandler(error: RedisOmError): any {
  if (error?.name) {
    throw new GeneralError(error, {
      name: error.name,
      message: error.message,
    });
  }

  throw error;
}
