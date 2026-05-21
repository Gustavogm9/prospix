import { Result, AppError } from '@prospix/shared-types';

export const ResultHelper = {
  success<T>(value: T): Result<T> {
    return { ok: true, value };
  },
  failure<T, E extends AppError = AppError>(error: E): Result<T, E> {
    return { ok: false, error };
  }
};
