/** The public surface of `@querent/shared`. */
export {
  apiPrefix,
  buildPath,
  defineEndpoint,
  type Endpoint,
  type EndpointInput,
  type EndpointOutput,
  type HttpMethod,
  type ParsedEndpointInput,
} from './api/contract.ts';
export {
  type ApiErrorBody,
  type ApiErrorCode,
  apiErrorBodySchema,
  apiErrorCodes,
} from './api/errors.ts';
export { healthEndpoint } from './api/health.ts';
export { meEndpoint } from './api/me.ts';
export {
  type AuthMode,
  authModeSchema,
  hasRole,
  type Principal,
  principalSchema,
  type Role,
  roleSchema,
  roles,
} from './roles.ts';
