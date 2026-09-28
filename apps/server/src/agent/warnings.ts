/** Sends the model SDK's warnings to the server's logger instead of the console. */
import type { Logger } from '../lib/logger.ts';

/**
 * Routes the SDK's warnings, such as "structured output is not supported", to the logger as one
 * JSON line each, instead of stack traces on the console.
 *
 * @param logger - The server's logger.
 */
export function routeModelWarnings(logger: Logger): void {
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
    logger.warn('model warning', { provider, model, warnings });
  };
}
