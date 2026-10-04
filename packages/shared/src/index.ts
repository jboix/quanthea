/** The public surface of `@quanthea/shared`. */

export {
  compareFrameValues,
  type Field,
  type FieldType,
  type Frame,
  fieldSchema,
  fieldTypes,
  frameProblems,
  frameSchema,
  pluginNamePattern,
  type QueryLanguage,
  queryLanguageSchema,
  queryLanguages,
} from '@quanthea/plugin-kit/contract';
export * from './alerts/notification-values.ts';
export * from './alerts/replay-steps.ts';
export * from './alerts/spec-changes.ts';
export * from './alerts/state-machine.ts';
export {
  type Answer,
  type AnswerCitation,
  type AnswerData,
  type AnswerEvidence,
  answerCitationSchema,
  answerDataSchemas,
} from './answers.ts';
export * from './api/alert-drafts.ts';
export * from './api/alert-links.ts';
export * from './api/alerts.ts';
export {
  changePasswordEndpoint,
  completeSetupEndpoint,
  setPasswordEndpoint,
  signInEndpoint,
  signOutEndpoint,
  signOutEverywhereEndpoint,
} from './api/auth.ts';
export * from './api/bin.ts';
export * from './api/charts.ts';
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
export * from './api/conversation-bin.ts';
export {
  createDashboardEndpoint,
  type DashboardDetail,
  type DashboardPage,
  type DashboardVersion,
  dashboardDetailSchema,
  dashboardPageSchema,
  dashboardVersionSchema,
  getDashboardEndpoint,
  getDashboardVersionEndpoint,
  pinDashboardEndpoint,
  unpinDashboardEndpoint,
} from './api/dashboards.ts';
export {
  type ApiErrorBody,
  type ApiErrorCode,
  apiErrorBodySchema,
  apiErrorCodes,
} from './api/errors.ts';
export * from './api/explanations.ts';
export { healthEndpoint } from './api/health.ts';
export {
  enableIdentityProviderEndpoint,
  getIdentityProvidersEndpoint,
  type IdentityProvidersView,
  type IdentityProviderView,
  identityProviderSchema,
  identityProvidersSchema,
  type JoinPolicy,
  joinPolicySchema,
  myIdentitiesEndpoint,
  type ProviderFlowFailure,
  type ProviderKind,
  passwordSignInEndpoint,
  providerCallbackPath,
  providerFlowFailure,
  providerFlowFailures,
  providerFlowIntents,
  providerKinds,
  providerStartPath,
  removeIdentityProviderEndpoint,
  type StoredProvider,
  saveIdentityProviderEndpoint,
  signInOptionsEndpoint,
  storedSignInSchema,
  unlinkIdentityEndpoint,
} from './api/identity-providers.ts';
export {
  type LibraryEntry,
  type LibrarySearch,
  librarySearchSchema,
  searchLibraryEndpoint,
} from './api/library.ts';
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
export * from './api/notification-channels.ts';
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
export * from './api/questions.ts';
export * from './api/retention.ts';
export {
  getManagedSettingsEndpoint,
  getServerSettingsEndpoint,
  type ManagedSettings,
  type ServerSettingsView,
  type SettingSource,
} from './api/server-settings.ts';
export {
  getSnapshotEndpoint,
  listDashboardSnapshotsEndpoint,
  listSnapshotsEndpoint,
  revokeSnapshotEndpoint,
  type Snapshot,
  type SnapshotLifetime,
  type SnapshotSummary,
  snapshotLifetimes,
  snapshotSchema,
  snapshotSummarySchema,
  takeSnapshotEndpoint,
} from './api/snapshots.ts';
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
  type ThreadListItem,
  type ThreadSummary,
  threadChatPath,
  threadDetailSchema,
  threadFromDashboardEndpoint,
  threadSummarySchema,
} from './api/threads.ts';
export {
  type UsageBucket,
  type UsageReport,
  usageBucketSchema,
  usageReportEndpoint,
  usageReportSchema,
} from './api/usage.ts';
export {
  endUserSessionsEndpoint,
  inviteUserEndpoint,
  listUsersEndpoint,
  resetLinkEndpoint,
  type UserView,
  updateUserEndpoint,
  userSchema,
} from './api/users.ts';
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
export { type CalendarParts, calendarParts, dayMonth } from './formatters/calendar.ts';
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
  type ModelVendor,
  modelVendors,
  suggestedProviderName,
  vendorLabel,
  vendorOf,
} from './model-vendors.ts';
export * from './notifications.ts';
export {
  jsonQueryLanguages,
  placeholdersOf,
  type QueryParamKind,
  type QuerySettings,
  queryParamKinds,
  querySettingsSchema,
  type SavedQuery,
  savedQuerySchema,
  type ThreadQueries,
  threadQueriesSchema,
} from './queries.ts';
export {
  type BuilderLanguage,
  builderLanguages,
  type QueryBuilder,
  queryBuilders,
} from './query-builders.ts';
export {
  hasRole,
  type Principal,
  principalSchema,
  type Role,
  roleSchema,
  roles,
} from './roles.ts';
export * from './spec/alert.ts';
export {
  type Annotation,
  type DashboardSpec,
  dashboardSpecSchema,
  gridColumns,
  type MarkerColor,
  markerColors,
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
export { fixedTimeOf } from './spec/fixed-time.ts';
export { refIdSchema, slugSchema, variableNameSchema } from './spec/names.ts';
export {
  durationSchema,
  type PanelQuery,
  panelQuerySchema,
  type QueryTemplate,
  queryLanguageNames,
  queryTemplateSchema,
  queryText,
  queryTextKey,
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
export * from './threads.ts';
