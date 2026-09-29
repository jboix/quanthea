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
  createDashboardEndpoint,
  type DashboardDetail,
  type DashboardVersion,
  dashboardDetailSchema,
  dashboardVersionSchema,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  pinDashboardEndpoint,
} from './api/dashboards.ts';
export {
  type ApiErrorBody,
  type ApiErrorCode,
  apiErrorBodySchema,
  apiErrorCodes,
} from './api/errors.ts';
export { healthEndpoint } from './api/health.ts';
export { meEndpoint } from './api/me.ts';
export {
  getModelSettingsEndpoint,
  listModelsEndpoint,
  listProviderChoicesEndpoint,
  type ModelSettingsView,
  modelSettingsViewSchema,
  modelTestSchema,
  type ProviderChoice,
  providerChoiceSchema,
  saveModelSettingsEndpoint,
  testModelSettingsEndpoint,
} from './api/model-settings.ts';
export {
  type MarkerOutcome,
  type PanelRun,
  panelRunSchema,
  type QueryOutcome,
  runPanelEndpoint,
  variableOptionsEndpoint,
} from './api/panels.ts';
export {
  getQueryGuideEndpoint,
  getQuerySettingsEndpoint,
  listQueryChoicesEndpoint,
  previewQueryEndpoint,
  previewRanges,
  type QueryChoice,
  type QueryGuide,
  type QueryPreview,
  queryChoiceSchema,
  saveQuerySettingsEndpoint,
} from './api/queries.ts';
export {
  approvePlanEndpoint,
  createThreadEndpoint,
  deleteThreadEndpoint,
  getThreadEndpoint,
  listThreadsEndpoint,
  rejectPlanEndpoint,
  restoreVersionEndpoint,
  startFromPinnedEndpoint,
  type ThreadDetail,
  type ThreadSummary,
  threadChatPath,
  threadDetailSchema,
  threadSummarySchema,
} from './api/threads.ts';
export {
  type UsageBucket,
  type UsageReport,
  usageBucketSchema,
  usageReportEndpoint,
  usageReportSchema,
} from './api/usage.ts';
export { chartIndex, chartRecipe, chartRecipes } from './chart-recipes/catalogue.ts';
export { type ChartUnit, chartUnits, unitFormatter } from './chart-recipes/conventions.ts';
export { type ChartChoice, fillView } from './chart-recipes/fill.ts';
export { type PrepareKind, prepareKinds } from './chart-recipes/prepare.ts';
export { type ChartFamily, type ChartRecipe, chartFamilies } from './chart-recipes/recipe.ts';
export { inferRoles, type RoleColumns, roleProblems } from './chart-recipes/roles.ts';
export { themeTokens } from './chart-recipes/tokens.ts';
export {
  type AccessLevel,
  accessLevelSchema,
  connectorNameSchema,
  defaultAccessLevel,
  descriptionsSchema,
  type Guardrails,
  guardrailsSchema,
  hiddenFieldsSchema,
  lowCardinalityLimit,
} from './connectors.ts';
export {
  type Cell,
  type Dataset,
  type Dimension,
  type DimensionType,
  datasetSchema,
  type ShapeKind,
  shapeGuides,
  shapeKinds,
} from './dataset/contract.ts';
export { datasetOfFrames } from './dataset/from-frames.ts';
export {
  columnIndex,
  columnValues,
  compareCells,
  filterRows,
  fiveNumbers,
  histogramBins,
  longToWide,
  rowsToGraph,
  rowsToTree,
  sortRows,
  type TreeNode,
} from './dataset/reshape.ts';
export {
  createFormatter,
  type FormatFunction,
  type FormatOptions,
} from './formatters/format.ts';
export {
  type Formatter,
  formatterSchema,
  type NamedFormatter,
  namedFormatterSchema,
} from './formatters/schema.ts';
export {
  compareFrameValues,
  type Field,
  type FieldType,
  type Frame,
  fieldSchema,
  fieldTypes,
  frameProblems,
  frameSchema,
} from './frames.ts';
export {
  type GatewayPreset,
  gatewayPresets,
  type KnownModel,
  type ProviderProfile,
  providerProfiles,
} from './model-providers.ts';
export {
  defaultModelGateway,
  defaultModelSettings,
  type ModelGateway,
  type ModelProvider,
  type ModelSettings,
  modelGatewaySchema,
  modelProviders,
  modelSettingsSchema,
  type ProviderConfig,
  providerConfigSchema,
  providerFor,
  settingsFor,
} from './model-settings.ts';
export {
  addUsage,
  costOf,
  type ModelPrice,
  modelPrices,
  noUsage,
  priceOf,
  pricesCheckedOn,
  type TokenUsage,
  type TurnUsage,
  tokenUsageSchema,
  turnUsageSchema,
} from './model-usage.ts';
export {
  type PanelUnit,
  panelUnits,
  placeholdersOf,
  type QueryBuilder,
  type QueryParamKind,
  type QuerySettings,
  queryBuilders,
  queryParamKinds,
  querySettingsSchema,
  type SavedQuery,
  savedQuerySchema,
  type ThreadQueries,
  threadQueriesSchema,
} from './queries.ts';
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
export {
  type Annotation,
  type DashboardSpec,
  dashboardSpecSchema,
  gridColumns,
  type Panel,
} from './spec/dashboard.ts';
export {
  type DiffLine,
  diffLines,
  diffSpecs,
  type FieldChange,
  type PanelDiff,
  type SpecDiff,
} from './spec/diff.ts';
export { refIdSchema, slugSchema, variableNameSchema } from './spec/names.ts';
export {
  type PanelQuery,
  panelQuerySchema,
  type QueryTemplate,
  queryTemplateSchema,
} from './spec/queries.ts';
export {
  type ResolvedTimeRange,
  resolveTime,
  resolveTimeRange,
  type TimeRangeExpression,
  timeRangeSchema,
} from './spec/time.ts';
export {
  allValue,
  isMultiValue,
  type Variable,
  type VariableValues,
  variableSchema,
  variableValuesSchema,
} from './spec/variables.ts';
export {
  type ChartView,
  type DatasetTransform,
  type Reduce,
  type StatView,
  type TableView,
  type View,
  viewSchema,
} from './spec/views.ts';
export {
  type Plan,
  type PlanView,
  planPanelKinds,
  planSchema,
  planStatuses,
  planViewSchema,
  type ThreadData,
  type ThreadState,
  threadDataSchemas,
  threadStates,
} from './threads.ts';
