/** The public surface of `@querent/shared`. */

export {
  type ConnectorDetail,
  type ConnectorKindInfo,
  type ConnectorSummary,
  connectorDetailSchema,
  connectorInputSchema,
  connectorKindSchema,
  connectorPatchSchema,
  connectorSummarySchema,
  createConnectorEndpoint,
  deleteConnectorEndpoint,
  getConnectorEndpoint,
  getConnectorSchemaEndpoint,
  healthReportSchema,
  listConnectorKindsEndpoint,
  listConnectorsEndpoint,
  refreshConnectorSchemaEndpoint,
  type SchemaView,
  schemaViewSchema,
  testConnectorEndpoint,
  updateConnectorEndpoint,
} from './api/connectors.ts';
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
  type AccessLevel,
  accessLevelSchema,
  connectorNameSchema,
  defaultAccessLevel,
  descriptionsSchema,
  type Guardrails,
  guardrailsSchema,
  hiddenFieldsSchema,
} from './connectors.ts';
export {
  type Field,
  type FieldType,
  type Frame,
  fieldSchema,
  fieldTypes,
  frameProblems,
  frameSchema,
} from './frames.ts';
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
