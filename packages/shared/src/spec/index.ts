/** The spec's part of the public surface of `@quanthea/shared`. */

export * from './alert.ts';
export * from './alert-condition.ts';
export * from './alert-ratio.ts';
export * from './chart-interval.ts';
export {
  type Annotation,
  type DashboardSpec,
  dashboardSpecSchema,
  gridColumns,
  type MarkerColor,
  markerColors,
  maxSections,
  type Panel,
  type Section,
  sectionSchema,
  type ValueColor,
  valueColorSchema,
} from './dashboard.ts';
export {
  type DiffLine,
  diffLines,
  diffSpecs,
  type FieldChange,
  type PanelDiff,
  type SpecDiff,
} from './diff.ts';
export { fixedStepOf } from './fixed-step.ts';
export { fixedTimeOf } from './fixed-time.ts';
export { followsTimeRange } from './follows-time-range.ts';
export {
  type Arranged,
  applyLayout,
  type DashboardLayout,
  dashboardLayoutSchema,
  type LaidOutSpec,
  type LayoutPanel,
  layoutProblems,
  type PanelGrid,
  packGrid,
  packLayout,
  specLayout,
} from './layout.ts';
export {
  type DashboardLink,
  isDashboardLink,
  type Link,
  type LinkContext,
  type LinkValue,
  linkAddress,
  linkedDashboards,
  linkSchema,
  urlLinkValue,
} from './links.ts';
export { refIdSchema, slugSchema, variableNameSchema } from './names.ts';
export {
  calculateFunctions,
  type Operation,
  operationSchema,
  operationsSchema,
} from './operations.ts';
export {
  durationSchema,
  type PanelQuery,
  panelQuerySchema,
  type QueryTemplate,
  queryLanguageNames,
  queryTemplateSchema,
  queryText,
  queryTextKey,
} from './queries.ts';
export * from './report.ts';
export {
  copyLimit,
  maxSectionCopies,
  type SectionGroup,
  sectionGroups,
  sectionProblems,
} from './sections.ts';
export {
  type ResolvedTimeRange,
  resolveTime,
  resolveTimeRange,
  type TimeRangeExpression,
  timeRangeSchema,
} from './time.ts';
export { computedInTitle, filledTitle } from './title.ts';
export { isStep, levelTone, type Mapping, mapValue, type Tone, type ToneAs } from './tones.ts';
export {
  httpsHostOf,
  type UrlLink,
  urlLinkAddress,
  urlLinkHost,
  urlPlaceholder,
} from './url-links.ts';
export {
  labelOfValue,
  optionLabel,
  optionValue,
  optionValues,
  type VariableOption,
} from './variable-options.ts';
export {
  allValue,
  autoInterval,
  type ChosenVariable,
  chosenVariableSchema,
  isChosen,
  isMultiValue,
  maxComputedValueLength,
  maxComputedValues,
  maxTextValueLength,
  offersAll,
  type Variable,
  type VariableValues,
  variableDefault,
  variableSchema,
  variableSource,
  variableValuesSchema,
} from './variables.ts';
export {
  type ChartView,
  type DatasetTransform,
  type LogView,
  maxLogLines,
  maxStatTiles,
  type Reduce,
  type StatView,
  type TableView,
  type View,
  viewLinks,
  viewSchema,
} from './views.ts';
