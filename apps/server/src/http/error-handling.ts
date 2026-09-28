/** Turns thrown errors and unknown routes into the `/api` error shape. */
import type { ApiErrorBody, ApiErrorCode } from '@querent/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { AppError } from '../lib/errors.ts';
import { errorFields, type Logger } from '../lib/logger.ts';
import type { AppEnv } from './app-env.ts';

/**
 * Builds an error response body.
 *
 * @param code - The stable error code.
 * @param message - A message safe to show.
 * @param details - Optional structured context.
 * @returns The body, with `details` only when there are some.
 */
function errorBody(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/**
 * Creates the handler for errors thrown by routes and middleware. An {@link AppError} is sent as
 * is. Anything else is logged with the request id and answered with a generic 500, so internal
 * messages never reach the client.
 *
 * @param logger - Receives unexpected errors.
 * @returns The error handler.
 */
export function handleErrors(logger: Logger): ErrorHandler<AppEnv> {
  return (error, context) => {
    if (error instanceof AppError) {
      return context.json(errorBody(error.code, error.message, error.details), error.status);
    }
    const requestId = context.get('requestId');
    logger.error('unhandled error', { requestId, ...errorFields(error) });
    return context.json(errorBody('internal', `Something went wrong (request ${requestId}).`), 500);
  };
}

/**
 * Answers requests that match no route.
 *
 * @param context - The request context.
 * @returns A 404 in the error shape.
 */
export const handleNotFound: NotFoundHandler<AppEnv> = (context: Context<AppEnv>) =>
  context.json(
    errorBody('not_found', `No route for ${context.req.method} ${context.req.path}.`),
    404,
  );
