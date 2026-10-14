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
  type Panel,
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
export { refIdSchema, slugSchema, variableNameSchema } from './names.ts';
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
  type ResolvedTimeRange,
  resolveTime,
  resolveTimeRange,
  type TimeRangeExpression,
  timeRangeSchema,
} from './time.ts';
export { isStep, type Mapping, mapValue, type Tone, type ToneAs } from './tones.ts';
export {
  labelOfValue,
  optionLabel,
  optionValue,
  optionValues,
  type VariableOption,
} from './variable-options.ts';
export {
  allValue,
  isMultiValue,
  maxTextValueLength,
  offersAll,
  type Variable,
  type VariableValues,
  variableSchema,
  variableValuesSchema,
} from './variables.ts';
export {
  type ChartView,
  type DatasetTransform,
  type Reduce,
  type StatView,
  type TableView,
  type View,
  viewSchema,
} from './views.ts';
