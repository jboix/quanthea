/** Reads the API token a request carries in its `Authorization` header. */
import { apiTokenPrefix } from '@quanthea/shared';

/** The longest token read; a real one is far shorter. */
const maximumLength = 128;

/**
 * The API token of a request: the value of `Authorization: Bearer`, when it is one of quanthea's.
 * Another scheme, or a bearer value that is not an API token, belongs to something in front of
 * quanthea and is ignored.
 *
 * @param request - The request.
 * @returns The token, or `undefined`.
 */
export function apiTokenOf(request: Request): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, value, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || rest.length > 0)
    return undefined;
  if (!value.startsWith(apiTokenPrefix) || value.length > maximumLength) return undefined;
  return value;
}
